import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { marketing } from "../../premium/marketing-client";
import { ARCHETYPES, ARCHETYPE_LABEL, QUIZ, type Archetype, type QuizAnswers } from "../../premium/marketing-contract";
import { scoringModel } from "../../scoring/model";
import { previewText } from "../../sequence-preview";
import { store } from "../../store";
import type { Sequence } from "../../store/types";
import { classify } from "../archetype";
import { composeLandingContent } from "../capture";
import { composeCopy, GEN_TYPES } from "../compose";
import { reraLine } from "../facts";
import { AI_LABEL, generateDrafts, writeLandingHeroLine } from "../generate";
import { guardCopy, withReraLine } from "../guard";
import { composeLanding } from "../landing";
import { ARCHETYPE_SEQUENCES, ensureArchetypeSequences } from "../nurture";
import type { HarnessTool, OutboundKind, ShipItem, ToolContext } from "../harness/types";
import { brandKitFor, groundProject, linkedToSpine, NotGrounded } from "./grounding";
import { inAppDeliverer } from "./deliver";
import { audit as salesAudit } from "../../store";
import { catalogue, covers } from "./catalogue";

/**
 * M1–M3 AS HARNESS TOOLS. Each WRAPS the existing feature logic —
 * generateDrafts / guardCopy / composeCopy (M1 content), composeLandingContent,
 * QUIZ + classify, the human-written ARCHETYPE_SEQUENCES (M2 funnel), the
 * deterministic scoring model and the spine's attribution report (M3).
 *
 * TENANCY: tools read and write ONLY ctx.memory (this workspace's company
 * memory). Drafts, landing drafts, calendars and the dry-run outbox are
 * memory items; nothing is written to the single-tenant premium spine.
 * Premium is READ only for a workspace linked to it (grounding.ts).
 *
 * ONE SEND PATH — every outbound tool (sequence steps incl. the archetype
 * first touch, email, social publish, landing go-live) sends through
 * sendOutbound(), routed by CHANNEL, only after an operator approved it:
 *   in_app    LIVE — delivered through the desk's one sender (./deliver.ts):
 *             the lead's conversation thread + the prospect's in-app inbox; sent:true.
 *   everything else (email, WhatsApp, SMS, social, landing go-live) DRY-RUN
 *             until connected: the would-send is recorded, sent:false, flagged.
 * Exactly once: each send is keyed by its approval id; a repeat returns the
 * first result and sends nothing. Every send is recorded once in the outbox
 * and once on the lead's sales timeline (plus the harness trace/audit).
 */

/** Which channels actually deliver today. Everything else is dry-run (never in_app). */
export const LIVE_CHANNELS = new Set(["in_app"]);
export const OUTBOUND_MODE = "dry_run" as const;
const DRY_RUN_NOTE = "Dry run — this channel isn't connected yet. Recorded what WOULD be sent; nothing left the building.";

/** Memory kinds the marketing tools keep. */
export const KINDS = { draft: "content_draft", landing: "landing_draft", funnel: "funnel_config", sequence: "sequence_plan", calendar: "calendar", outbox: "outbox", report: "report" } as const;

const SOCIAL_CHANNELS = ["instagram", "facebook", "linkedin", "youtube"] as const;

async function save(ctx: ToolContext, kind: string, title: string, data: Record<string, unknown>, text: string, key: string = randomUUID()) {
  return ctx.memory.upsert({ kind, key, title: title.slice(0, 200), data: { ...data, goalId: ctx.goalId, taskId: ctx.taskId }, text, source: `tool:${kind}` });
}

export interface SendResult {
  sent: boolean;
  mode: "live" | "dry_run" | "no_recipient";
  outboxId: string;
  channel: string;
  premiumMessageId?: string | null;
  note: string;
  repeat?: boolean;
}

/**
 * THE ONE SEND PATH. `recipient` (leadId) + `template` are needed for in_app:
 * the template is rendered for that lead at send time and delivered live.
 */
export async function sendOutbound(ctx: ToolContext, input: { tool: string; channel: string; payload: Record<string, unknown>; ships: ShipItem[]; leadId?: string | null; template?: string | null }): Promise<SendResult> {
  // Exactly once per approved action.
  if (ctx.approvalId) {
    const prior = (await ctx.memory.list(KINDS.outbox)).find((o) => o.data.approvalId === ctx.approvalId);
    if (prior) return { ...(prior.data.result as SendResult), repeat: true };
  }
  const title = `${input.channel}: ${String(input.payload.title ?? input.payload.subject ?? input.tool)}`;
  const base = { tool: input.tool, channel: input.channel, payload: input.payload, ships: input.ships, leadId: input.leadId ?? null, approvalId: ctx.approvalId ?? null, approvedBy: ctx.actor, at: ctx.now };
  const record = async (result: Omit<SendResult, "outboxId">, extra: Record<string, unknown> = {}) => {
    const key = randomUUID();
    const full: SendResult = { ...result, outboxId: key };
    await save(ctx, KINDS.outbox, title, { ...base, ...extra, sent: full.sent, mode: full.mode, result: full }, String(extra.body ?? input.ships.map((s) => s.text).join("\n")), key);
    return full;
  };

  if (LIVE_CHANNELS.has(input.channel)) {
    if (!input.leadId || !input.template) {
      const r = await record({ sent: false, mode: "no_recipient", channel: input.channel, note: "Not sent — an in-app message needs a lead to send to (this step had none)." });
      return r;
    }
    const delivered = await inAppDeliverer().deliver({ leadId: input.leadId, template: input.template, reraRegNo: input.ships[0]?.reraRegNo ?? "", complianceLine: input.ships[0]?.complianceLine, sentBy: `marketing:${ctx.actor.replace(/^operator:/, "")}` });
    const r = await record({ sent: true, mode: "live", channel: input.channel, premiumMessageId: delivered.premiumMessageId, note: "Delivered in-app — in the lead's conversation thread and the prospect's inbox." }, { body: delivered.body });
    await salesAudit("marketing-message-delivered", input.leadId, ctx.actor, `${title} — delivered in-app (sent:true)`);
    return r;
  }
  const r = await record({ sent: false, mode: OUTBOUND_MODE, channel: input.channel, note: DRY_RUN_NOTE });
  if (input.leadId) await salesAudit("marketing-message-dry-run", input.leadId, ctx.actor, `${title} — dry-run, ${input.channel} not connected (sent:false)`);
  return r;
}

const fail = (message: string): never => {
  throw new Error(message);
};

// ─── brand kit ──────────────────────────────────────────────────────────────

export const brandkitGet: HarnessTool<Record<string, never>> = {
  name: "brandkit.get",
  description: "Reads this workspace's brand kit (company memory brand_kit; a spine-linked workspace falls back to the spine's kit). Read-only.",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  effect: "read",
  requiresApproval: false,
  scopes: ["memory:read"],
  handler: async (_input, ctx) => {
    const { kit, source } = await brandKitFor(ctx);
    return kit ? { source, builderName: kit.builderName, toneOfVoice: kit.toneOfVoice, reraRegNo: kit.defaultReraRegNo, colors: [kit.primaryColor, kit.secondaryColor] } : { source: null, note: 'No brand kit — add one to company memory (kind "brand_kit", key "main").' };
  },
};

// ─── M1 content ─────────────────────────────────────────────────────────────

const GenTypeSchema = z.enum(["social_post", "caption", "ad_copy"]);

export const contentGenerate: HarnessTool<{ projectKey: string; types?: z.infer<typeof GenTypeSchema>[] }> = {
  name: "content.generate",
  description: "DRAFTS social posts, captions and ad copy for a project from its facts (M1 generator: model in the brand's tone, claims guard, RERA line, AI label; template fallback). Drafts only — never publishes.",
  inputSchema: z.object({ projectKey: z.string().min(1), types: z.array(GenTypeSchema).min(1).max(3).optional() }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "content:write"],
  handler: async (input, ctx) => {
    const g = await groundProject(ctx, input.projectKey);
    const drafts = await generateDrafts(g.property.name, g.kit, g.grounding, input.types ?? GEN_TYPES);
    const saved = [];
    for (const d of drafts) {
      const item = await save(ctx, KINDS.draft, d.title, { ...d, reraRegNo: g.grounding.reraRegNo, projectKey: input.projectKey, grounding: g.source }, d.body);
      saved.push({ id: item.key, type: d.type, channel: d.channel, engine: d.engine, aiLabel: d.aiLabel });
    }
    return { draftIds: saved.map((s) => s.id), drafts: saved, source: g.source, warnings: g.grounding.warnings.slice(0, 3) };
  },
};

export const contentSeoCopy: HarnessTool<{ projectKey: string }> = {
  name: "content.seoCopy",
  description: "DRAFTS SEO + landing copy for a project: title tag, meta description, H1 and strapline, from its facts (M1/M2 composers + the guarded AI strapline). Draft only.",
  inputSchema: z.object({ projectKey: z.string().min(1) }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "content:write"],
  handler: async (input, ctx) => {
    const g = await groundProject(ctx, input.projectKey);
    const rera = g.grounding.reraRegNo ?? fail("Set the RERA registration number (brand kit or project) first — every asset must carry it.");
    const composed = composeLanding(g.property, g.kit, g.grounding);
    const hero = await writeLandingHeroLine(g.grounding, g.kit, composed.hero.subhead);
    const meta = composeCopy("caption", g.grounding.facts, rera).body.split("\n")[0];
    const verdict = guardCopy(withReraLine(meta, rera), g.grounding.facts, rera, "caption");
    if (!verdict.ok) fail(`SEO copy failed the claims guard: ${verdict.problems.join("; ")}`);
    const loc = g.grounding.facts.find((f) => f.key === "locality")?.value;
    const titleTag = `${g.property.name}${g.property.config ? ` — ${g.property.config}` : ""}${loc ? ` in ${loc}` : ""}`.slice(0, 60);
    const seo = { titleTag, metaDescription: meta.slice(0, 155), h1: composed.hero.headline, strapline: hero.subhead, keywords: g.grounding.facts.filter((f) => ["locality", "config", "type", "location"].includes(f.key)).map((f) => f.value) };
    const aiLabel = hero.engine === "llm" ? AI_LABEL.llm : AI_LABEL.template;
    const body = withReraLine([seo.h1, seo.strapline, seo.metaDescription].filter(Boolean).join("\n"), rera);
    const item = await save(ctx, KINDS.draft, `SEO — ${titleTag}`, { type: "seo", channel: "web", title: titleTag, body, seo, engine: hero.engine, aiLabel, reraRegNo: rera, projectKey: input.projectKey, factKeys: [] }, body);
    return { draftId: item.key, titleTag, engine: hero.engine, aiLabel };
  },
};

// ─── M2 funnel ──────────────────────────────────────────────────────────────

export const landingDraft: HarnessTool<{ projectKey: string }> = {
  name: "landing.draft",
  description: "DRAFTS a project landing page (M2 composer from verified facts, honest grade, RERA block, lead magnets; optional guarded AI strapline). Saved as a draft in company memory — not live.",
  inputSchema: z.object({ projectKey: z.string().min(1) }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "funnel:write"],
  handler: async (input, ctx) => {
    const g = await groundProject(ctx, input.projectKey);
    const { content } = await composeLandingContent(g.property, g.kit, g.grounding);
    const slug = `${input.projectKey}-${randomUUID().slice(0, 6)}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const aiLabel = content.engine === "llm" ? AI_LABEL.llm : AI_LABEL.template;
    const item = await save(ctx, KINDS.landing, content.hero.headline, { slug, content, headline: content.hero.headline, subhead: content.hero.subhead, reraRegNo: content.rera.regNo, aiLabel, engine: content.engine, projectKey: input.projectKey, status: "draft" }, `${content.hero.headline}\n${content.hero.subhead ?? ""}`);
    return { landingId: item.key, slug, headline: content.hero.headline, subhead: content.hero.subhead, reraRegNo: content.rera.regNo, aiLabel, engine: content.engine };
  },
};

const landingShips = (i: { headline: string; subhead: string | null; reraRegNo: string; aiLabel: string }): ShipItem[] => [
  { text: `${i.headline}\n${i.subhead ?? ""}\n${reraLine(i.reraRegNo)}`, reraRegNo: i.reraRegNo, aiLabel: i.aiLabel, aiAssisted: true },
];

export const landingPublish: HarnessTool<{ landingId: string; slug: string; headline: string; subhead: string | null; reraRegNo: string; aiLabel: string }> = {
  name: "landing.publish",
  description: "Puts a drafted landing page LIVE. Outbound (go-live): always needs operator approval. Currently DRY-RUN — records what would go live; nothing is published.",
  inputSchema: z.object({ landingId: z.string().min(1), slug: z.string().min(1), headline: z.string().min(1), subhead: z.string().nullable(), reraRegNo: z.string().min(1), aiLabel: z.string().min(1) }),
  effect: "outbound",
  outbound: "go_live",
  requiresApproval: true,
  scopes: ["outbound:go_live"],
  summarize: (i) => `Put the landing page /${i.slug} live ("${i.headline}")`,
  ships: landingShips,
  handler: async (input, ctx) => {
    const draft = (await ctx.memory.get(KINDS.landing, input.landingId)) ?? fail("That landing page draft isn't in this workspace.");
    if (draft.data.headline !== input.headline || (draft.data.subhead ?? null) !== input.subhead || draft.data.reraRegNo !== input.reraRegNo) fail("What was approved doesn't match the stored draft — nothing published.");
    return sendOutbound(ctx, { tool: "landing.publish", channel: "landing_page", payload: { title: input.headline, slug: input.slug, landingId: input.landingId }, ships: landingShips(input) });
  },
};

const QuizKey = z.enum(Object.keys(QUIZ) as [keyof typeof QUIZ, ...(keyof typeof QUIZ)[]]);

export const funnelQuizConfigure: HarnessTool<{ questions?: (keyof typeof QUIZ)[]; projectKey?: string }> = {
  name: "funnel.quizConfigure",
  description: "Configures the archetype quiz: the M2 questions, the deterministic classification rules, and routing + tagging (each archetype → its human-written nurture sequence, tag archetype:<type>). Config only.",
  inputSchema: z.object({ questions: z.array(QuizKey).min(1).optional(), projectKey: z.string().optional() }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "funnel:write"],
  handler: async (input, ctx) => {
    const sequences = await humanSequences(ctx);
    const questions = (input.questions ?? (Object.keys(QUIZ) as (keyof typeof QUIZ)[])).map((k) => ({ key: k, label: QUIZ[k].label, options: QUIZ[k].options }));
    const routing = ARCHETYPES.map((a) => ({ archetype: a, label: ARCHETYPE_LABEL[a], tag: `archetype:${a}`, sequenceId: sequences.find((s) => s.params.archetype === a)?.id ?? null }));
    const rules = ["lives outside India → NRI", "buying to rent out / invest → Investor", "first home purchase → First-time buyer", "owns a smaller home and moving up → Upgrader", "otherwise → End-user family"];
    const item = await save(ctx, KINDS.funnel, "Archetype quiz", { questions, routing, rules, classifier: "deterministic (lib/marketing/archetype.ts)", projectKey: input.projectKey ?? null }, rules.join("\n"), "quiz");
    return { configId: item.key, questions: questions.length, routes: routing.filter((r) => r.sequenceId).length };
  },
};

/** The HUMAN-WRITTEN nurture sequences: the operator's edited ones for a spine-linked workspace, else the defaults in lib/marketing/nurture.ts. Never model-written. */
async function humanSequences(ctx: Pick<ToolContext, "workspace">): Promise<Sequence[]> {
  return linkedToSpine(ctx) ? ensureArchetypeSequences() : ARCHETYPE_SEQUENCES;
}

export const sequenceBuild: HarnessTool<{ archetypes?: Archetype[] }> = {
  name: "sequence.build",
  description: "Assembles per-archetype nurture sequences from the HUMAN-WRITTEN messages (M2). Never rewrites them with a model — templates are copied verbatim, with an example preview. Plan only.",
  inputSchema: z.object({ archetypes: z.array(z.enum(ARCHETYPES)).min(1).optional() }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "funnel:write"],
  handler: async (input, ctx) => {
    const sequences = await humanSequences(ctx);
    const built = [];
    for (const archetype of input.archetypes ?? [...ARCHETYPES]) {
      const s = sequences.find((x) => x.params.archetype === archetype && x.active);
      if (!s) continue;
      const steps = s.steps.map((step) => ({ offsetHours: step.offsetHours, channel: step.channel, template: step.template, preview: previewText(step.template) }));
      await save(ctx, KINDS.sequence, s.name, { archetype, sequenceId: s.id, name: s.name, steps, humanWritten: true, rewrittenByModel: false, source: linkedToSpine(ctx) ? "sales store (operator-edited)" : "lib/marketing/nurture.ts" }, steps.map((x) => x.template).join("\n"), archetype);
      built.push({ archetype, sequenceId: s.id, steps: steps.length });
    }
    return { sequences: built, humanWritten: true };
  },
};

// ─── M3 distribution ────────────────────────────────────────────────────────

export const distributionPlanCalendar: HarnessTool<{ draftIds?: string[]; startDate?: string; everyDays?: number; hourIst?: number }> = {
  name: "distribution.planCalendar",
  description: "PLANS the social calendar: slots this goal's drafted posts/captions on their channels (default daily at 10:00 IST from tomorrow). A plan only — publishing is a separate, approval-gated step. Ad copy is left out (paid ads need ads.spend, not built).",
  inputSchema: z.object({ draftIds: z.array(z.string()).max(30).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), everyDays: z.number().int().min(1).max(14).optional(), hourIst: z.number().int().min(6).max(22).optional() }),
  effect: "internal",
  requiresApproval: false,
  scopes: ["memory:read", "distribution:write"],
  handler: async (input, ctx) => {
    const drafts = await draftsFor(ctx, input.draftIds);
    const social = drafts.filter((d) => (SOCIAL_CHANNELS as readonly string[]).includes(String(d.data.channel)));
    if (social.length === 0) fail("No drafted social posts or captions for this goal yet — the content sub-agent drafts them first.");
    const start = input.startDate ? new Date(`${input.startDate}T00:00:00+05:30`) : new Date(new Date(ctx.now).getTime() + 86_400_000);
    const day = start.toISOString().slice(0, 10);
    const slots = social.map((d, i) => {
      const at = new Date(`${day}T${String(input.hourIst ?? 10).padStart(2, "0")}:00:00+05:30`);
      at.setUTCDate(at.getUTCDate() + i * (input.everyDays ?? 1));
      return { draftId: d.key, channel: String(d.data.channel), title: d.title, at: at.toISOString() };
    });
    const item = await save(ctx, KINDS.calendar, `Calendar — ${slots.length} post${slots.length === 1 ? "" : "s"}`, { slots, skipped: drafts.filter((d) => d.data.type === "ad_copy").map((d) => ({ draftId: d.key, why: "paid ads need ads.spend (not built)" })) }, slots.map((s) => `${s.at} ${s.channel} ${s.title}`).join("\n"));
    return { calendarId: item.key, slots: slots.length, first: slots[0].at };
  },
};

/** This goal's content drafts (or the given ids) — this workspace only. */
export async function draftsFor(ctx: Pick<ToolContext, "memory" | "goalId">, ids?: string[]) {
  const all = await ctx.memory.list(KINDS.draft);
  return ids?.length ? all.filter((d) => ids.includes(d.key)) : all.filter((d) => d.data.goalId === ctx.goalId);
}

const postShips = (i: { text: string; reraRegNo: string; aiLabel: string }): ShipItem[] => [{ text: i.text, reraRegNo: i.reraRegNo, aiLabel: i.aiLabel, aiAssisted: true }];

/** Outbound copy must be EXACTLY a stored draft of this workspace (what the operator approved is what would ship). */
async function matchDraft(ctx: ToolContext, draftId: string, text: string, reraRegNo: string) {
  const d = (await ctx.memory.get(KINDS.draft, draftId)) ?? fail("That draft isn't in this workspace.");
  if (d.data.body !== text || d.data.reraRegNo !== reraRegNo) fail("What was approved doesn't match the stored draft — nothing sent.");
  return d;
}

export const distributionPublishPost: HarnessTool<{ draftId: string; channel: (typeof SOCIAL_CHANNELS)[number]; text: string; reraRegNo: string; aiLabel: string; scheduledAt?: string }> = {
  name: "distribution.publishPost",
  description: "PUBLISHES a drafted social post. Outbound (publish): always needs operator approval. Currently DRY-RUN — records what would be posted; no social API is called.",
  inputSchema: z.object({ draftId: z.string().min(1), channel: z.enum(SOCIAL_CHANNELS), text: z.string().min(1), reraRegNo: z.string().min(1), aiLabel: z.string().min(1), scheduledAt: z.string().optional() }),
  effect: "outbound",
  outbound: "publish",
  requiresApproval: true,
  scopes: ["outbound:publish"],
  summarize: (i) => `Publish to ${i.channel}${i.scheduledAt ? ` on ${new Date(i.scheduledAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST` : ""}: "${i.text.split("\n")[0].slice(0, 80)}${i.text.split("\n")[0].length > 80 ? "…" : ""}"`,
  ships: postShips,
  handler: async (input, ctx) => {
    const d = await matchDraft(ctx, input.draftId, input.text, input.reraRegNo);
    return sendOutbound(ctx, { tool: "distribution.publishPost", channel: input.channel, payload: { title: d.title, draftId: input.draftId, scheduledAt: input.scheduledAt ?? null }, ships: postShips(input) });
  },
};

export const emailSend: HarnessTool<{ draftId: string; subject: string; text: string; reraRegNo: string; aiLabel: string; audienceKey?: string }> = {
  name: "email.send",
  description: "SENDS a drafted email to an audience's consented buyers. Outbound (send): always needs operator approval. Currently DRY-RUN — records what would be sent; no email provider is called.",
  inputSchema: z.object({ draftId: z.string().min(1), subject: z.string().min(1).max(200), text: z.string().min(1), reraRegNo: z.string().min(1), aiLabel: z.string().min(1), audienceKey: z.string().optional() }),
  effect: "outbound",
  outbound: "send",
  requiresApproval: true,
  scopes: ["outbound:send"],
  summarize: (i) => `Email "${i.subject}"${i.audienceKey ? ` to audience ${i.audienceKey}` : ""}`,
  ships: postShips,
  handler: async (input, ctx) => {
    await matchDraft(ctx, input.draftId, input.text, input.reraRegNo);
    const audience = input.audienceKey ? await ctx.memory.get("audience", input.audienceKey) : null;
    return sendOutbound(ctx, { tool: "email.send", channel: "email", payload: { title: input.subject, subject: input.subject, draftId: input.draftId, audience: audience ? audience.title : "no audience given", recipients: "consented recipients would be resolved at send time" }, ships: postShips(input) });
  },
};

const stepShips = (i: { text: string; reraRegNo: string }): ShipItem[] => [{ text: i.text, reraRegNo: i.reraRegNo, aiLabel: "Not AI-generated (human-written nurture message)", aiAssisted: false }];

export const sequenceSendStep: HarnessTool<{ archetype: Archetype; stepIndex: number; text: string; reraRegNo: string; leadKey?: string }> = {
  name: "sequence.sendStep",
  description: "SENDS one step of an archetype's nurture sequence to a lead — the HUMAN-WRITTEN message, verbatim, with the RERA line. Outbound (send): always needs operator approval. in_app steps are DELIVERED; WhatsApp / SMS / email steps are dry-run until those channels are connected.",
  inputSchema: z.object({ archetype: z.enum(ARCHETYPES), stepIndex: z.number().int().min(0).max(20), text: z.string().min(1), reraRegNo: z.string().min(1), leadKey: z.string().optional() }),
  effect: "outbound",
  outbound: "send",
  requiresApproval: true,
  scopes: ["outbound:send"],
  summarize: (i) => `Send step ${i.stepIndex + 1} of the ${ARCHETYPE_LABEL[i.archetype]} nurture sequence${i.leadKey ? ` to ${i.leadKey}` : ""}`,
  ships: stepShips,
  handler: async (input, ctx) => {
    const s = (await humanSequences(ctx)).find((x) => x.params.archetype === input.archetype && x.active) ?? fail(`No nurture sequence for ${input.archetype}.`);
    const step = s.steps[input.stepIndex] ?? fail(`Step ${input.stepIndex + 1} doesn't exist.`);
    // Exactly the human-written template + the RERA line — nothing rewritten.
    if (input.text !== sequenceStepText(step.template, input.reraRegNo)) fail("The message differs from the human-written sequence — nothing sent.");
    // The lead must be enrolled in THIS workspace (tenant check) before anything reaches it.
    const leadId = input.leadKey?.startsWith("lead-") && (await ctx.memory.get("enrolment", input.leadKey)) ? input.leadKey.slice(5) : null;
    return sendOutbound(ctx, { tool: "sequence.sendStep", channel: step.channel, payload: { title: `${s.name} · step ${input.stepIndex + 1}`, sequenceId: s.id, stepIndex: input.stepIndex, leadKey: input.leadKey ?? null }, ships: stepShips(input), leadId, template: step.template });
  },
};

export const sequenceStepText = (template: string, reraRegNo: string) => `${template}\n\n${reraLine(reraRegNo)}`;
export { humanSequences };

// ─── MKT-16 first touch ─────────────────────────────────────────────────────

/** Company-memory record of a lead's first-touch drafts (pointer + our outbound copy — never the lead's data). */
export const FIRST_TOUCH_KIND = "first_touch";

export interface FirstTouchMessage {
  index: number;
  /** answer = the reply to the buyer's question; welcome = acknowledgement / archetype welcome / brochure. */
  role: "answer" | "welcome";
  types: string[];
  body: string;
  aiLabel: string;
  status: "drafted" | "sent" | "held" | "declined" | "not_sent";
  approvalId: string | null;
  sentAt: string | null;
  note: string | null;
}

/** The project's RERA line or its exemption statement — the line the message must end with. */
const firstTouchShips = (i: { body: string; complianceLine: string; reraRegNo: string; aiLabel: string }): ShipItem[] => [{ text: `${i.body}\n\n${i.complianceLine}`, reraRegNo: i.reraRegNo, complianceLine: i.complianceLine, aiLabel: i.aiLabel, aiAssisted: true }];

export const firstTouchReply: HarnessTool<{ leadKey: string; index: number; body: string; complianceLine: string; reraRegNo: string; aiLabel: string }> = {
  name: "first_touch.reply",
  description: "Sends one first-touch message to a new lead in-app, with its RERA line and AI label — exactly the text drafted for that lead in this workspace. Outbound (send): approval-gated; only the low-risk types a workspace switched to automatic go without approval (lib/marketing/agents/first-touch.ts). Not plannable by agents.",
  inputSchema: z.object({ leadKey: z.string().regex(/^lead-/), index: z.number().int().min(0).max(5), body: z.string().min(1).max(500), complianceLine: z.string().min(5).max(300), reraRegNo: z.string().max(120), aiLabel: z.string().min(1) }),
  effect: "outbound",
  outbound: "send",
  requiresApproval: true,
  scopes: ["outbound:send"],
  summarize: (i) => `First reply to ${i.leadKey.slice(5)}: "${i.body.split("\n")[0].slice(0, 90)}${i.body.split("\n")[0].length > 90 ? "…" : ""}"`,
  ships: firstTouchShips,
  handler: async (input, ctx) => {
    const record = (await ctx.memory.get(FIRST_TOUCH_KIND, input.leadKey)) ?? fail("No first-touch draft for that lead in this workspace — nothing sent.");
    const message = (record.data.messages as FirstTouchMessage[] | undefined)?.[input.index] ?? fail("That first-touch message doesn't exist.");
    if (message.body !== input.body || record.data.complianceLine !== input.complianceLine || message.aiLabel !== input.aiLabel) fail("What was approved doesn't match the stored draft — nothing sent.");
    return sendOutbound(ctx, { tool: "first_touch.reply", channel: "in_app", payload: { title: `First reply ${input.index + 1} · ${input.leadKey}`, leadKey: input.leadKey, index: input.index, types: message.types }, ships: firstTouchShips(input), leadId: String(record.data.leadId), template: input.body });
  },
};

// ─── M3 analytics (read / compute) ──────────────────────────────────────────

const Answer = <K extends keyof typeof QUIZ>(k: K) => z.enum(Object.keys(QUIZ[k].options) as [string, ...string[]]);
const AnswersSchema = z.object({ purpose: Answer("purpose"), residence: Answer("residence"), firstHome: Answer("firstHome"), household: Answer("household"), currentHome: Answer("currentHome") });

export const leadArchetype: HarnessTool<{ answers: z.infer<typeof AnswersSchema> }> = {
  name: "lead.archetype",
  description: "Classifies a buyer's archetype from the 5 quiz answers — DETERMINISTIC rules, no model (the spine's classifier).",
  inputSchema: z.object({ answers: AnswersSchema }),
  effect: "read",
  requiresApproval: false,
  scopes: ["analytics:read"],
  handler: async (input) => {
    const r = classify(input.answers as QuizAnswers);
    return { ...r, label: ARCHETYPE_LABEL[r.archetype], tag: `archetype:${r.archetype}`, sequenceId: ARCHETYPE_SEQUENCES.find((s) => s.params.archetype === r.archetype)?.id ?? null, model: "deterministic-rules" };
  },
};

export const leadScore: HarnessTool<{ leadId: string }> = {
  name: "lead.score",
  description: "Scores a lead hot / warm / cold with reasons — the DETERMINISTIC scoring model, no model call — read from the premium leads store (only this workspace's builder's leads), with its archetype tag.",
  inputSchema: z.object({ leadId: z.string().min(1) }),
  effect: "read",
  requiresApproval: false,
  scopes: ["memory:read", "analytics:read"],
  handler: async (input, ctx) => {
    if (!linkedToSpine(ctx)) fail("This workspace isn't linked to a builder in the premium inventory, so it has no leads.");
    const lead = (await catalogue().getLead(input.leadId).catch(() => null)) ?? fail("No such lead in the premium leads store.");
    const property = await catalogue().getProperty(lead.propertyId).catch(() => null);
    if (!property || !covers(ctx.workspace, property)) fail("That lead isn't on one of this workspace's buildings.");
    const [visits, checkIns, feedback, optIn, attribution] = await Promise.all([store().listVisits({ leadId: lead.id }), store().listCheckIns({ leadId: lead.id }), store().listFeedback({ leadId: lead.id }), store().getOptIn(lead.id), catalogue().attribution(lead.id)]);
    const s = scoringModel().score({ lead, property, visits, checkIns, feedback, optIn });
    return { leadId: lead.id, building: property!.name, source: "premium", score: s.score, band: s.band, archetype: attribution?.archetype ?? null, top: s.top.map((r) => `${r.label} (${r.points > 0 ? "+" : ""}${r.points})`), model: s.model };
  },
};

export const analyticsReport: HarnessTool<{ campaignId?: string }> = {
  name: "analytics.report",
  description: "Campaign performance + cost-per-booking attribution (M3 dashboard data). Read-only. Spine attribution for a linked workspace; otherwise this workspace's own pipeline (drafts, planned posts, dry-run outbox).",
  inputSchema: z.object({ campaignId: z.string().optional() }),
  effect: "read",
  requiresApproval: false,
  scopes: ["memory:read", "analytics:read"],
  handler: async (input, ctx) => {
    const [drafts, landing, calendars, outbox] = await Promise.all([ctx.memory.list(KINDS.draft), ctx.memory.list(KINDS.landing), ctx.memory.list(KINDS.calendar), ctx.memory.list(KINDS.outbox)]);
    const pipeline = {
      drafts: drafts.length,
      landingDrafts: landing.length,
      plannedPosts: calendars.reduce((n, c) => n + (Array.isArray(c.data.slots) ? c.data.slots.length : 0), 0),
      dryRunOutbox: Object.entries(outbox.reduce<Record<string, number>>((m, o) => ({ ...m, [String(o.data.channel)]: (m[String(o.data.channel)] ?? 0) + 1 }), {})).map(([channel, n]) => ({ channel, wouldHaveSent: n })),
    };
    let attribution: unknown = { note: "Attribution (leads, site visits, bookings, cost per booking) comes from the spine — link this workspace to it (builderId) to include it." };
    if (linkedToSpine(ctx)) {
      const r = await marketing.attribution(input.campaignId ? { campaignId: input.campaignId } : {});
      attribution = { totals: r.totals, campaigns: r.campaigns.slice(0, 20).map((c) => ({ name: c.name, status: c.status, budgetInr: c.budgetInr, leads: c.leads, siteVisits: c.siteVisits, bookings: c.bookings, spendInr: c.spendInr, costPerBooking: c.costPerBooking })), definitions: r.definitions };
    }
    const item = await save(ctx, KINDS.report, `Report ${ctx.now.slice(0, 10)}`, { pipeline, attribution }, JSON.stringify(pipeline));
    return { reportId: item.key, pipeline, linked: linkedToSpine(ctx) };
  },
};

// ─── the ads.spend seam (NOT BUILT) ─────────────────────────────────────────

/**
 * SEAM — paid ads. Not built: no ad platform is connected and spend is a
 * human decision. When it is built, register it like this (outbound
 * "ad_spend" → always approval-gated; the copy it promotes must ship with its
 * RERA line + AI label) and add "ads.spend" to a sub-agent type's tools:
 *
 *   registerTool(adsSpendTool(async (input, ctx) => …platform call…));
 */
export function adsSpendTool(handler: HarnessTool<{ draftId: string; channel: string; dailyBudgetInr: number; text: string; reraRegNo: string; aiLabel: string }>["handler"]): HarnessTool<{ draftId: string; channel: string; dailyBudgetInr: number; text: string; reraRegNo: string; aiLabel: string }> {
  const kind: OutboundKind = "ad_spend";
  return {
    name: "ads.spend",
    description: "Runs a paid ad with a daily budget. Outbound (ad spend): always needs operator approval.",
    inputSchema: z.object({ draftId: z.string(), channel: z.string(), dailyBudgetInr: z.number().positive(), text: z.string(), reraRegNo: z.string(), aiLabel: z.string() }),
    effect: "outbound",
    outbound: kind,
    requiresApproval: true,
    scopes: ["outbound:ad_spend"],
    summarize: (i) => `Spend ₹${i.dailyBudgetInr}/day on ${i.channel}`,
    ships: postShips,
    handler,
  };
}

/** Every M1–M3 tool (and the MKT-16 first touch), with the sub-agent type that owns it. */
export const MARKETING_TOOLS: { tool: HarnessTool<never>; owner: "content" | "funnel" | "distribution" | "analytics" }[] = [
  { tool: brandkitGet, owner: "content" },
  { tool: contentGenerate, owner: "content" },
  { tool: contentSeoCopy, owner: "content" },
  { tool: landingDraft, owner: "funnel" },
  { tool: landingPublish, owner: "funnel" },
  { tool: funnelQuizConfigure, owner: "funnel" },
  { tool: sequenceBuild, owner: "funnel" },
  { tool: distributionPlanCalendar, owner: "distribution" },
  { tool: distributionPublishPost, owner: "distribution" },
  { tool: emailSend, owner: "distribution" },
  { tool: sequenceSendStep, owner: "distribution" },
  { tool: firstTouchReply, owner: "funnel" },
  { tool: leadScore, owner: "analytics" },
  { tool: leadArchetype, owner: "analytics" },
  { tool: analyticsReport, owner: "analytics" },
] as unknown as { tool: HarnessTool<never>; owner: "content" | "funnel" | "distribution" | "analytics" }[];

export { NotGrounded };

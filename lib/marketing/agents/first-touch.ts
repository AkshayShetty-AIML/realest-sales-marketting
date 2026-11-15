import "server-only";
import { ARCHETYPES, type Archetype } from "../../premium/marketing-contract";
import { audit as salesAudit, store as salesStore } from "../../store";
import type { AutoReply } from "../../store/types";
import { buildFacts } from "../../grounding/facts";
import { greetingName, topicsOf, type Topic } from "../../grounding/compose";
import { draftGroundedReply } from "../../grounding/llm";
import { generateBrochure } from "../../brochure/generate";
import { mintBrochureLink } from "../../links";
import { alertFirstReply, FIRST_REPLY_TARGET_MS, holdFirstReply, openFirstReply, overdueFirstReplies, overdueReason, recordFirstReply } from "../../automation/response-time";
import { notify, onEvent, registerTickHook } from "../harness/automation";
import { workspaceMemory } from "../harness/memory";
import type { HarnessStore } from "../harness/store";
import { effectiveTool, invoke } from "../harness/tools";
import { audit, complianceCheck, requestApproval } from "../harness/trust";
import type { ToolContext } from "../harness/types";
import { brandKitFor } from "./grounding";
import { catalogue, covers } from "./catalogue";
import { leadKey } from "./nurture-events";
import { FIRST_TOUCH_KIND, firstTouchReply, type FirstTouchMessage } from "./tools";

/**
 * MKT-16 · AUTOMATED FIRST TOUCH — the first reply to a new lead, prepared
 * and sent through the channel layer WITHOUT waiting for approval, but only
 * when the lead's workspace switched it on (off by default) and only for
 * LOW-RISK types:
 *
 *   acknowledgement     thanks + who follows up
 *   archetype_welcome   a fixed, human-written line for the buyer's type
 *   brochure            the personalised brochure (SAL-05), as a private link
 *   grounded_answer     the answer drawn ONLY from the project's verified
 *                       facts (SAL-04: the guard throws away anything else)
 *
 * Anything touching price changes, offers / discounts / negotiation,
 * availability promises, legal claims or returns is DRAFTED and waits for an
 * operator's approval — exactly as before. Every message carries the RERA
 * line and an AI label, and goes through the one send path
 * (first_touch.reply → sendOutbound): in-app is delivered to the lead's
 * thread; every other channel stays dry-run.
 *
 * THE EXCEPTION, NARROWLY: outbound normally always waits for a human (the
 * gate in ../harness/trust.ts — unchanged). This module is the only caller
 * that runs an outbound tool without an approval, for these four types, when
 * the workspace switch is on, the harness is on, the tool is enabled there,
 * and the compliance check passed. Each auto-send is audited as such.
 *
 * UNTRUSTED INPUT: the lead's message is third-party text. It is only ever
 * input to drafting and to the risk check — the steps here are fixed code, so
 * nothing a buyer writes can choose or trigger a tool.
 *
 * Reads go through the shared source only (./catalogue.ts). Time from the
 * lead's arrival to the first message is recorded (lib/automation/response-time.ts).
 */

export const FIRST_TOUCH_TYPES = [
  { type: "acknowledgement", label: "Acknowledgement", what: "Thanks the buyer for the enquiry and says a colleague will be in touch." },
  { type: "archetype_welcome", label: "Welcome for their type of buyer", what: "A fixed, human-written line for NRI, investor, first-time, upgrader or family buyers." },
  { type: "brochure", label: "Personalised brochure", what: "A private link to a brochure built from their enquiry and the project's verified facts." },
  { type: "grounded_answer", label: "Answer from verified project data", what: "Answers only what the project's verified data covers; anything else is passed to a colleague." },
] as const;

export const ALWAYS_NEEDS_APPROVAL = ["Price changes", "Offers, discounts or negotiation", "Availability promises or holding a unit", "Legal claims (RERA status, title, approvals, litigation)", "Returns or investment claims"] as const;

export const AUTO_LABEL = "Automated reply (AI-assisted)";
const IN_APP_MAX = 500;

/** Fixed, human-written welcome lines — no facts, no claims. */
export const ARCHETYPE_WELCOME: Record<Archetype, string> = {
  nri: "Buying from abroad? We can share a video walkthrough and handle the paperwork online, at a time that suits your time zone.",
  investor: "If you're looking at this as an investment, we can share the project's verified details and the documents you'll want to check.",
  first_time: "Buying your first home? We'll take you through each step, from the site visit to the paperwork, at your pace.",
  upgrader: "Moving up to more space? We can show you the layouts and arrange a visit when it suits you.",
  end_user_family: "Looking for a home for your family? We can arrange a visit so everyone can see it together.",
};

const RISKY_TOPICS: Partial<Record<Topic, string>> = {
  discount: "offers, discounts or negotiation",
  availability: "availability (no promise without a person)",
  legal: "a legal claim (RERA status, title, approvals)",
  investment: "returns or investment terms",
};
const RISKY_WORDS: [RegExp, string][] = [
  [/\b(discount|offers?|deal|negotia|best price|lower (the )?price|reduc(e|tion)|waive|cashback|freebie)/i, "offers, discounts or negotiation"],
  [/\b(price|rate|cost)\b.{0,24}\b(change|drop|cut|increase|hike|revis|go(ing)? up|lock)|\bprice (change|drop|cut|increase|hike|revision)/i, "a price change"],
  [/\b(guarantee|assured|promise|hold (a|the|my|one) (unit|flat|apartment)|reserve|block (a|the|my) (unit|flat))/i, "an availability promise"],
  [/\b(legal|litigation|lawsuit|court|title deed|clear title|encumbrance|occupancy certificate|rera (status|complaint))/i, "a legal claim"],
  [/\b(returns?|yield|appreciat\w*|rental income|roi)\b/i, "returns or investment claims"],
];

/** Why a reply must wait for a person — from what the buyer asked and from the drafted answer itself. Empty = low risk. */
export function riskReasons(kind: string, question: string, draft: string): string[] {
  const reasons = new Set<string>();
  for (const t of topicsOf(kind, question)) if (RISKY_TOPICS[t]) reasons.add(`the buyer asked about ${RISKY_TOPICS[t]}`);
  for (const [pattern, what] of RISKY_WORDS) {
    if (pattern.test(question)) reasons.add(`the buyer asked about ${what}`);
    if (pattern.test(draft)) reasons.add(`the drafted answer touches ${what}`);
  }
  return Array.from(reasons);
}

const fits = (body: string, rera: string) => `${body}\n\nRERA Reg. No.: ${rera}`.length <= IN_APP_MAX;

export type FirstTouchOutcome =
  | { status: "off"; reason: string }
  | { status: "already" }
  | { status: "sent" | "held" | "blocked"; leadKey: string; sent: number; held: number; reasons: string[]; firstReplyMs: number | null };

const asArchetype = (v: unknown): Archetype | null => (typeof v === "string" && (ARCHETYPES as readonly string[]).includes(v) ? (v as Archetype) : null);

export async function firstTouch(store: HarnessStore, workspaceId: string, leadId: string, opts: { trigger?: string; clock?: () => Date } = {}): Promise<FirstTouchOutcome> {
  const clock = opts.clock ?? (() => new Date());
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return { status: "off", reason: "workspace not found" };
  if (!workspace.enabled) return { status: "off", reason: "the harness is switched off for this workspace" };
  if (!workspace.autoFirstReply) return { status: "off", reason: "automatic first replies are off for this workspace" };
  const scoped = store.scope(workspaceId);
  const memory = workspaceMemory(scoped);
  const key = leadKey(leadId);
  if (await memory.get(FIRST_TOUCH_KIND, key)) return { status: "already" };

  // The shared source only.
  const lead = await catalogue().getLead(leadId);
  const property = await catalogue().getProperty(lead.propertyId);
  if (!covers(workspace, property)) return { status: "off", reason: `${property.name} isn't one of this workspace's buildings` };
  const eff = await effectiveTool(scoped, firstTouchReply.name);
  if (!eff?.enabled) return { status: "off", reason: "first_touch.reply is disabled in this workspace" };

  // One first reply per lead, whichever path: the same lock the desk's instant reply takes.
  const startedAt = clock().toISOString();
  const lock: AutoReply = { leadId, outcome: "failed", channel: "in_app", engine: "template", body: "", factKeys: [], handoffReason: "marketing first-touch in progress", providerId: null, at: startedAt };
  if (!(await salesStore().claimAutoReply(lock))) return { status: "already" };

  const attribution = await catalogue().attribution(leadId);
  const archetype = asArchetype(lead.archetype) ?? asArchetype(attribution?.archetype);
  const campaignId = attribution?.campaignId ?? null;
  await openFirstReply({ leadId, arrivedAt: lead.createdAt, workspaceId, campaignId });
  const ctx: ToolContext = { workspaceId, workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] }, goalId: null, taskId: null, runId: null, actor: "harness:first-touch", now: startedAt, memory };
  await audit(scoped, { kind: "first_touch.started", actor: "harness:first-touch", detail: `${key} · ${property.name}${archetype ? ` · ${archetype}` : ""} (the buyer's message is untrusted — used for drafting only)`, data: { leadId, trigger: opts.trigger ?? null, untrustedInput: true } });

  const finish = async (reply: Partial<AutoReply>) => salesStore().updateAutoReply({ ...lock, ...reply });
  const rera = (await brandKitFor(ctx)).kit?.defaultReraRegNo ?? null;
  if (!rera) {
    const note = "no RERA registration number in the brand kit — nothing can go out without it";
    await finish({ outcome: "handoff", handoffReason: `first reply blocked: ${note}` });
    await holdFirstReply({ leadId, arrivedAt: lead.createdAt, status: "blocked", note, workspaceId, campaignId });
    await audit(scoped, { kind: "first_touch.blocked", actor: "harness:first-touch", detail: `${key}: ${note}`, data: { leadId } });
    await notify(scoped, { kind: "first_touch_blocked", title: "New lead — first reply blocked", body: `${lead.contact.name ?? leadId} (${property.name}): ${note}`, ref: key });
    return { status: "blocked", leadKey: key, sent: 0, held: 0, reasons: [note], firstReplyMs: null };
  }

  // ── draft (the buyer's text is input to drafting and the risk check, nothing else) ──
  const facts = buildFacts(property);
  const [draft, brochureLink] = await Promise.all([
    draftGroundedReply({ kind: lead.kind, message: lead.message, contactName: lead.contact.name }, facts),
    generateBrochure(leadId, "first-touch", clock(), { lead, property })
      .then((b) => mintBrochureLink(leadId, b.id))
      .catch(async (error) => {
        await audit(scoped, { kind: "first_touch.brochure_skipped", actor: "harness:first-touch", detail: `${key}: ${error instanceof Error ? error.message : "brochure failed"}` });
        return null;
      }),
  ]);
  const reasons = riskReasons(lead.kind, lead.message, draft.body);
  const answerBody = `${draft.body}\n\n${AUTO_LABEL}`;
  // A risky question always gets a drafted reply for a person to approve — even when the facts can't answer it.
  const hasAnswer = !draft.handoff || reasons.length > 0;
  if (hasAnswer && !fits(answerBody, rera)) reasons.push(`the answer is too long for an in-app message (${answerBody.length} characters)`);
  const holdAnswer = hasAnswer && reasons.length > 0;

  const messages: FirstTouchMessage[] = [];
  if (hasAnswer) messages.push({ index: 0, role: "answer", types: ["acknowledgement", "grounded_answer"], body: answerBody, aiLabel: AUTO_LABEL, status: "drafted", approvalId: null, sentAt: null, note: null });
  const name = greetingName(lead.contact.name);
  const parts: { type: string; text: string }[] = [];
  if (!hasAnswer || holdAnswer) parts.push({ type: "acknowledgement", text: `Hi${name ? ` ${name}` : ""}, thanks for your interest in ${property.name}. ${holdAnswer ? "A colleague will reply to your question shortly." : "A member of our team will be in touch shortly."}` });
  if (archetype) parts.push({ type: "archetype_welcome", text: ARCHETYPE_WELCOME[archetype] });
  if (brochureLink) parts.push({ type: "brochure", text: `Here's a brochure we put together for you on ${property.name}: ${brochureLink}` });
  // Trim to the in-app limit: the welcome line goes first, then the brochure — the acknowledgement always stays.
  for (const drop of ["archetype_welcome", "brochure"]) {
    if (fits(`${parts.map((p) => p.text).join(" ")}\n\n${AUTO_LABEL}`, rera)) break;
    const i = parts.findIndex((p) => p.type === drop);
    if (i >= 0) parts.splice(i, 1);
  }
  if (parts.length) messages.push({ index: messages.length, role: "welcome", types: parts.map((p) => p.type), body: `${parts.map((p) => p.text).join(" ")}\n\n${AUTO_LABEL}`, aiLabel: AUTO_LABEL, status: "drafted", approvalId: null, sentAt: null, note: null });

  const save = () =>
    memory.upsert({
      kind: FIRST_TOUCH_KIND,
      key,
      title: `First reply — ${lead.contact.name ?? leadId}`,
      data: { leadId, propertyId: property.id, archetype, reraRegNo: rera, engine: draft.engine, factKeys: draft.factKeys, reasons, messages, startedAt },
      text: messages.map((m) => m.body).join("\n"),
      source: "harness:first-touch",
    });
  await save();

  // ── send the low-risk messages now; hold the rest for approval ──
  for (const m of messages) {
    const args = { leadKey: key, index: m.index, body: m.body, reraRegNo: rera, aiLabel: m.aiLabel };
    const compliance = complianceCheck("outbound", "send", firstTouchReply.ships!(args));
    if (m.role === "answer" && holdAnswer) {
      const approval = await requestApproval(scoped, { goalId: null, taskId: null, runId: null, tool: eff, args, reasons: [...reasons.map((r) => `${r} — a person decides`), "outbound (send) — always approved by a human"], kind: "action", requestedBy: "harness:first-touch", ships: firstTouchReply.ships!(args), now: clock().toISOString() });
      Object.assign(m, { status: "held", approvalId: approval.id, note: reasons.join("; ") });
      await audit(scoped, { kind: "first_touch.held", actor: "harness:first-touch", detail: `${key}: answer drafted, waiting for approval ${approval.id} — ${reasons.join("; ")}`, data: { leadId, approvalId: approval.id } });
      await notify(scoped, { kind: "approval_needed", title: "New lead — first reply to approve", body: approval.summary, ref: approval.id });
      continue;
    }
    if (!compliance.ok) {
      Object.assign(m, { status: "not_sent", note: compliance.problems.join("; ") });
      await audit(scoped, { kind: "first_touch.blocked", actor: "harness:first-touch", detail: `${key}: message ${m.index + 1} failed compliance — ${compliance.problems.join("; ")}`, data: { leadId } });
      continue;
    }
    const result = await invoke(eff.tool, args, { ...ctx, now: clock().toISOString(), approvalId: `auto:${leadId}:${m.index}` });
    const sent = result.ok && (result.result as { sent?: boolean }).sent === true;
    Object.assign(m, sent ? { status: "sent", sentAt: clock().toISOString() } : { status: "not_sent", note: result.ok ? String((result.result as { note?: string }).note ?? "not sent") : result.error });
    await audit(scoped, { kind: sent ? "first_touch.auto_sent" : "first_touch.not_sent", actor: "harness:first-touch", detail: `${key}: message ${m.index + 1} (${m.types.join(" + ")}) ${sent ? "sent in-app without approval — low-risk type, the workspace's automatic first replies are on" : `not sent — ${m.note}`}`, data: { leadId, types: m.types } });
  }
  await save();

  const sentMsgs = messages.filter((m) => m.status === "sent");
  const held = messages.filter((m) => m.status === "held").length;
  const first = sentMsgs[0];
  let firstReplyMs: number | null = null;
  if (first?.sentAt) {
    const row = await recordFirstReply({ leadId, arrivedAt: lead.createdAt, at: first.sentAt, path: "auto_first_reply", types: Array.from(new Set(sentMsgs.flatMap((m) => m.types))), workspaceId, campaignId });
    firstReplyMs = row.ms;
    if (row.ms !== null && row.ms > FIRST_REPLY_TARGET_MS) await notify(scoped, { kind: "first_reply_alert", title: "Slow first reply", body: `${lead.contact.name ?? leadId} (${property.name}): the first reply took ${(row.ms / 1000).toFixed(1)} s — over the 90-second target`, ref: key });
  } else {
    const note = held ? reasons.join("; ") : messages.map((m) => m.note).filter(Boolean).join("; ") || "nothing could be sent";
    await holdFirstReply({ leadId, arrivedAt: lead.createdAt, status: held ? "awaiting_approval" : "blocked", note, workspaceId, campaignId });
    if (!held) await notify(scoped, { kind: "first_reply_alert", title: "New lead — no first reply went out", body: `${lead.contact.name ?? leadId} (${property.name}): ${note}`, ref: key });
  }
  if (held && first) await alertFirstReply(leadId, `the answer to the buyer's question needs approval — ${reasons.join("; ")}`);
  await finish({
    outcome: held || !first ? "handoff" : "sent",
    engine: draft.engine,
    body: first?.body ?? "",
    factKeys: draft.factKeys,
    handoffReason: held ? `first reply: answer waiting for approval (${reasons.join("; ")})` : !first ? "first reply: nothing could be sent" : null,
  });
  await salesAudit("marketing-first-touch", leadId, "harness:first-touch", `${sentMsgs.length} sent automatically (${sentMsgs.flatMap((m) => m.types).join(", ") || "none"})${held ? `, answer waiting for approval — ${reasons.join("; ")}` : ""}${firstReplyMs !== null ? ` · first reply after ${(firstReplyMs / 1000).toFixed(1)} s` : ""}`);
  return { status: sentMsgs.length ? (held ? "held" : "sent") : held ? "held" : "blocked", leadKey: key, sent: sentMsgs.length, held, reasons, firstReplyMs };
}

/** approval.decided on a held first-touch answer → its outcome on the record (and the first reply, if nothing went before). */
async function onDecided(workspaceId: string, p: Record<string, unknown>, { store }: { store: HarnessStore }) {
  if (p.tool !== firstTouchReply.name) return;
  const args = (p.args ?? {}) as { leadKey?: string; index?: number };
  if (!args.leadKey) return;
  const scoped = store.scope(workspaceId);
  const memory = workspaceMemory(scoped);
  const item = await memory.get(FIRST_TOUCH_KIND, args.leadKey);
  if (!item) return;
  const messages = item.data.messages as FirstTouchMessage[];
  const m = messages.find((x) => x.approvalId === p.approvalId);
  if (!m) return;
  const executed = p.executed as { ok: boolean; observation: string } | null;
  let sent = false;
  try {
    sent = Boolean(executed?.ok && (JSON.parse(executed.observation) as { sent?: boolean }).sent);
  } catch {
    /* not JSON */
  }
  const at = new Date().toISOString();
  Object.assign(m, p.decision === "decline" ? { status: "declined", note: `declined by ${String(p.actor).replace(/^operator:/, "")}` } : sent ? { status: "sent", sentAt: at } : { status: "not_sent", note: executed?.observation ?? "not sent" });
  await memory.upsert({ kind: FIRST_TOUCH_KIND, key: args.leadKey, title: item.title, data: { ...item.data, messages }, text: item.text, source: item.source });
  const leadId = String(item.data.leadId);
  await audit(scoped, { kind: `first_touch.${m.status}`, actor: String(p.actor), detail: `${args.leadKey}: held answer ${m.status}${m.note ? ` — ${m.note}` : ""}`, data: { leadId, approvalId: p.approvalId } });
  if (sent) {
    const row = await salesStore().getFirstReply(leadId);
    if (row) await recordFirstReply({ leadId, arrivedAt: row.arrivedAt, at, path: "approved_draft", types: m.types });
  }
}

/** Engine tick: this store's workspaces' leads still without a first reply 90 s after arriving → one alert each. */
export async function alertOverdue(store: HarnessStore, now: Date): Promise<number> {
  let alerted = 0;
  for (const w of await store.listWorkspaces()) {
    for (const row of await overdueFirstReplies(now, w.id)) {
      if (!(await alertFirstReply(row.leadId, overdueReason(row, now), now.toISOString()))) continue;
      await notify(store.scope(w.id), { kind: "first_reply_alert", title: "No first reply yet", body: `${row.leadId}: ${overdueReason(row, now)}`, ref: leadKey(row.leadId) });
      alerted += 1;
    }
  }
  return alerted;
}

export function registerFirstTouchListeners(): void {
  onEvent("approval.decided", onDecided, "marketing:first-touch-decided");
  registerTickHook("marketing:first-reply-overdue", async (store, now) => void (await alertOverdue(store, now)));
}

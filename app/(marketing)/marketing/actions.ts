"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRepForAction } from "@/lib/auth";
import { premium, PremiumError } from "@/lib/premium/client";
import { generateCopy, GenerationBlocked, type GeneratedDraft } from "@/lib/marketing/generate";
import { CopyRejected, queueReel, saveDraft, saveKit, uploadLogo } from "@/lib/marketing/studio";
import { GEN_TYPES } from "@/lib/marketing/compose";
import { generateLandingPage } from "@/lib/marketing/capture";
import { EnrolError, enrolLead } from "@/lib/marketing/nurture";
import { bridgeLeadCaptured } from "@/lib/marketing/lead-bridge";
import { move } from "@/lib/marketing/approval";
import { BroadcastBlocked, draftBroadcast, publishDue, sendBroadcast } from "@/lib/marketing/distribution";
import { ARCHETYPE_LABEL, OBJECT_TYPES, PUBLISH_STATUSES, SOCIAL_CHANNELS } from "@/lib/premium/marketing-contract";
import { GOALS, describeList, fromFriendly, standardCampaignName, trackingCode, usedFields } from "@/lib/marketing/labels";
import { marketing } from "@/lib/premium/marketing-client";
import { ListRules, resolveList } from "@/lib/marketing/buyer-lists";
import { QUIZ, type QuizAnswers } from "@/lib/premium/marketing-contract";

/**
 * Marketing workspace actions. Same shape as app/actions.ts: signed-in
 * roster user, zod-validated input, errors as { ok: false, error } — never a
 * stack, never a key. Everything created here is a DRAFT on the spine.
 * TODO(roles): marketing operators currently share the sales roster; gate
 * the marketing workspace on an operator role when roles land.
 */

/** Spine refusals in words a builder understands. */
function plainError(error: PremiumError): string {
  switch (error.code) {
    case "approval_blocked":
      return `This can't be approved yet — ${error.message.replace(/^approval refused: /, "").replace(/the copy does not show the RERA reg\. no\./g, "add your RERA number to the text").replace(/no RERA registration number/g, "add your RERA number in Brand settings")}.`;
    case "illegal_transition":
    case "not_approved":
      return "This needs to be approved first.";
    case "invalid_schedule":
      return "Pick a time in the future and at least one place to post.";
    case "send_required":
      return "Use “Send now” to send this message.";
    case "not_schedulable":
      return "Only posts can be scheduled — publish this directly once it's approved.";
    case "conflict":
      return error.message.includes("utm_campaign") ? "A campaign with this name already exists." : "Someone else changed this a moment ago — refresh and try again.";
    case "invalid_request":
      return "Something in the form isn't right — please check and try again.";
    default:
      return error.status >= 500 || error.status === 502 || error.status === 503 ? "We couldn't reach the system just now — try again in a minute." : error.message;
  }
}

export type ActionResult<T = undefined> = { ok: true; data?: T; note?: string } | { ok: false; error: string };

async function run<T>(paths: string[], work: (actor: string) => Promise<{ data?: T; note?: string }>): Promise<ActionResult<T>> {
  try {
    const rep = await requireRepForAction();
    const result = await work(rep.repId);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (error instanceof PremiumError) return { ok: false, error: plainError(error) };
    if (error instanceof CopyRejected || error instanceof GenerationBlocked || error instanceof EnrolError || error instanceof BroadcastBlocked) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "colour must be #RRGGBB");
const KitInput = z.object({
  builderName: z.string().trim().min(1).max(120).nullable(),
  primaryColor: Hex,
  secondaryColor: Hex,
  headingFont: z.string().trim().min(1).max(60),
  bodyFont: z.string().trim().min(1).max(60),
  toneOfVoice: z.string().trim().max(1000),
  defaultReraRegNo: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/._ -]{3,79}$/, "RERA reg no.: letters, digits and / . _ -").nullable(),
});

export async function saveBrandKitAction(input: unknown) {
  return run(["/marketing/brand-kit"], async (actor) => {
    await saveKit(KitInput.parse(input), actor);
    return { note: "Saved." };
  });
}

export async function uploadLogoAction(form: FormData) {
  return run(["/marketing/brand-kit"], async (actor) => {
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a logo file.");
    const kit = await uploadLogo({ type: file.type, size: file.size, bytes: await file.arrayBuffer() }, actor);
    return { data: kit.logoUrl, note: "Logo uploaded." };
  });
}

const PropertyId = z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/);

export async function generateContentAction(propertyId: string, types: string[]) {
  return run<{ drafts: GeneratedDraft[]; warnings: string[]; reraRegNo: string | null }>([], async () => {
    const chosen = z.array(z.enum(GEN_TYPES as [string, ...string[]])).min(1).parse(types) as typeof GEN_TYPES;
    const g = await generateCopy(PropertyId.parse(propertyId), chosen);
    return { data: { drafts: g.drafts, warnings: g.grounding.warnings, reraRegNo: g.grounding.reraRegNo } };
  });
}

const DraftSchema = z.object({
  propertyId: PropertyId,
  campaignId: z.string().max(160).optional(),
  type: z.enum(["social_post", "caption", "ad_copy"]),
  channel: z.string().max(40),
  title: z.string().max(160),
  body: z.string().min(1).max(4000),
  factKeys: z.array(z.string().max(40)).max(40),
  engine: z.enum(["llm", "template"]),
  edited: z.boolean(),
});

export async function saveContentDraftAction(input: unknown) {
  return run<{ id: string; status: string }>(["/marketing/content", "/marketing/dashboard"], async (actor) => {
    const asset = await saveDraft(DraftSchema.parse(input), actor);
    return { data: { id: asset.id, status: asset.status }, note: "Saved as a draft." };
  });
}

export async function generateReelAction(propertyId: string) {
  return run<{ jobId: string; assetId: string }>(["/marketing/content", "/marketing/dashboard"], async (actor) => {
    const r = await queueReel(PropertyId.parse(propertyId), actor);
    return { data: { jobId: r.job.id, assetId: r.asset.id }, note: "Video requested — it will appear under Videos. (Automatic video making is coming soon.)" };
  });
}

// ─── Landing pages, archetype, enrolment (Batch M2) ─────────────────────────

const OptId = z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/).optional();

export async function generateLandingAction(propertyId: string, campaignId?: string) {
  return run<{ id: string; slug: string }>(["/marketing/landing-pages"], async (actor) => {
    const page = await generateLandingPage(PropertyId.parse(propertyId), actor, OptId.parse(campaignId || undefined));
    return { data: { id: page.id, slug: page.slug }, note: `Draft page /${page.slug} created.` };
  });
}

const enumOf = <K extends keyof typeof QUIZ>(k: K) => z.enum(Object.keys(QUIZ[k].options) as [string, ...string[]]);
const QuizSchema = z.object({ purpose: enumOf("purpose"), residence: enumOf("residence"), firstHome: enumOf("firstHome"), household: enumOf("household"), currentHome: enumOf("currentHome") });

export async function setArchetypeAction(leadId: string, campaignId: string | null, answers: unknown) {
  return run<{ archetype: string | null }>(["/marketing/campaigns", campaignId ? `/marketing/campaigns/${campaignId}` : "/marketing/campaigns", "/inbox"], async (actor) => {
    const lead = await marketing.setArchetype(PropertyId.parse(leadId), QuizSchema.parse(answers) as QuizAnswers, actor);
    // Tagged after capture (quiz answered later) → the same bridge enrols it now (idempotent per lead).
    await bridgeLeadCaptured(lead);
    return { data: { archetype: lead.archetype }, note: "Saved." };
  });
}

export async function enrolAction(campaignId: string, leadId: string) {
  return run<{ sequence: string }>([`/marketing/campaigns/${campaignId}`], async (actor) => {
    const r = await enrolLead(PropertyId.parse(campaignId), PropertyId.parse(leadId), actor);
    // The same approval-gated path as a captured lead: one approval per step, in_app delivered on approval.
    const routed = await bridgeLeadCaptured(r.attribution);
    if (!routed.routed) throw new EnrolError("No marketing workspace is linked to this project's builder — link one in Agent Harness → Settings so its follow-ups can be approved and sent.");
    return { data: { sequence: r.sequence.name }, note: "Enrolled — the first message is waiting for approval (Agent Harness → Approvals, or on the lead)." };
  });
}

// ─── Approval gate, calendar, spend, broadcasts (Batch M3) ──────────────────

const ALL_MARKETING = ["/marketing/dashboard", "/marketing/approvals", "/marketing/calendar", "/marketing/content", "/marketing/landing-pages", "/marketing/campaigns"];

const TransitionInput = z.object({
  objectType: z.enum(OBJECT_TYPES),
  objectId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/),
  to: z.enum(PUBLISH_STATUSES),
  note: z.string().trim().max(500).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  publishChannels: z.array(z.enum(SOCIAL_CHANNELS)).max(4).optional(),
});

/** Every status move goes to the spine's gate (legal moves, RERA checks on approval, audit). */
export async function transitionAction(input: unknown) {
  return run<{ status: string }>(ALL_MARKETING, async (actor) => {
    const v = TransitionInput.parse(input);
    const r = await move(v.objectType, v.objectId, v.to, actor, { note: v.note, scheduledAt: v.scheduledAt, publishChannels: v.publishChannels });
    const words: Record<string, string> = { submitted: "Sent for approval.", approved: "Approved.", draft: "Moved back to draft.", scheduled: "Scheduled.", published: "Published." };
    return { data: { status: r.object.status }, note: words[r.object.status] ?? "Done." };
  });
}

export async function publishDueAction() {
  return run<{ published: number }>(ALL_MARKETING, async (actor) => {
    const r = await publishDue(new Date(), actor);
    return { data: { published: r.published.length }, note: r.published.length ? `${r.published.length} post${r.published.length === 1 ? "" : "s"} marked published.` : "Nothing is due yet." };
  });
}

const SpendInput = z.object({
  campaignId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/),
  channel: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, "channel: lowercase letters, digits, _"),
  amountInr: z.number().nonnegative().max(1e10),
  reach: z.number().int().nonnegative().optional(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["manual", "builder_passthrough"]),
  note: z.string().trim().max(300).optional(),
});

export async function addSpendAction(input: unknown) {
  return run(["/marketing/dashboard", "/marketing/campaigns"], async (actor) => {
    const v = SpendInput.parse(input);
    await marketing.addSpend({ ...v, enteredBy: actor });
    return { note: "Spend recorded." };
  });
}

const SegmentInput = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(120),
  rules: ListRules,
});

/** A buyer list is rules over the shared leads store — never typed-in buyers. Premium keeps the list; members are resolved live. */
export async function createSegmentAction(input: unknown) {
  return run<{ id: string }>(["/marketing/audiences"], async (actor) => {
    const v = SegmentInput.parse(input);
    const seg = await marketing.createSegment({ name: v.name, description: describeList(v.rules, { campaigns: new Map(), projects: new Map(), types: ARCHETYPE_LABEL }), rules: v.rules, createdBy: actor });
    return { data: { id: seg.id }, note: `List “${seg.name}” created.` };
  });
}

/** How many buyers the rules match right now (live from the shared leads store). */
export async function previewListAction(input: unknown) {
  return run<{ count: number }>([], async () => {
    const rules = ListRules.parse(input);
    return { data: { count: (await resolveList(rules)).leads.length } };
  });
}

const BroadcastInput = z.object({
  segmentId: z.string().min(1, "Choose who to send it to.").max(160),
  channel: z.enum(["email", "whatsapp"]),
  name: z.string().trim().min(1, "Give the message a name.").max(120),
  subject: z.string().trim().max(160).optional().transform((x) => x || undefined),
  body: z.string().trim().min(1, "Write the message.").max(3800),
  language: z.enum(["en", "hi"]).default("en"),
  campaignId: z.string().max(160).optional().transform((x) => x || undefined),
});

/** Friendly [First name] placeholders become the sender's fields; WhatsApp template details are filled in for the team. */
export async function createBroadcastAction(input: unknown) {
  return run<{ id: string }>(["/marketing/approvals", "/marketing/campaigns"], async (actor) => {
    const v = BroadcastInput.parse(input);
    if (/\{\{|\}\}/.test(v.body)) throw new Error("Use the Add buttons for names and project details instead of typing codes.");
    const templateName = trackingCode(v.name).replace(/-/g, "_").slice(0, 60) || "builder_update";
    const b = await draftBroadcast(
      {
        segmentId: v.segmentId,
        channel: v.channel,
        name: v.name,
        subject: v.subject,
        body: fromFriendly(v.body),
        campaignId: v.campaignId,
        ...(v.channel === "whatsapp" ? { waTemplateName: templateName, waTemplateLanguage: v.language, waTemplateVariables: usedFields(v.body) } : {}),
      },
      actor,
    );
    return { data: { id: b.id }, note: "Saved as a draft." };
  });
}

export async function sendBroadcastAction(broadcastId: string) {
  return run(["/marketing/approvals", "/marketing/campaigns", "/marketing/dashboard"], async (actor) => {
    const b = await sendBroadcast(z.string().min(1).max(160).parse(broadcastId), actor);
    const d = b.deliveries;
    const parts = [d.sent ? `${d.sent} sent` : null, d.pending_twilio ? `${d.pending_twilio} waiting for WhatsApp to be switched on` : null, d.failed ? `${d.failed} couldn't be sent` : null].filter(Boolean);
    return { note: `Done — ${parts.join(", ") || "nothing to send"}.` };
  });
}

const CampaignInput = z.object({
  propertyId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/, "Choose a project."),
  goal: z.enum(GOALS.map((g) => g.value) as [string, ...string[]]),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose a month."),
  budgetInr: z.number().nonnegative().max(1e10).optional(),
});

/** A new campaign, named by the standard: "<Project> · <Goal> · <Mon YYYY>". */
export async function createCampaignAction(input: unknown) {
  return run<{ id: string }>(["/marketing/campaigns", "/marketing/dashboard"], async (actor) => {
    const v = CampaignInput.parse(input);
    const project = await premium.getProperty(v.propertyId);
    const name = standardCampaignName(project.name, v.goal, v.month);
    const [y, m] = v.month.split("-").map(Number);
    const c = await marketing.createCampaign({
      name,
      objective: v.goal,
      propertyId: project.id,
      budgetInr: v.budgetInr,
      channels: ["social", "email", "in_app"],
      startsAt: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
      endsAt: new Date(Date.UTC(y, m, 1)).toISOString(),
      utmCampaign: trackingCode(name),
      createdBy: actor,
    });
    return { data: { id: c.id }, note: `Campaign “${c.name}” created.` };
  });
}

import "server-only";
import { randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import type { Channel, LeadStage, LeadStatus } from "../premium/contract";
import { audit, store } from "../store";
import { buildFacts } from "../grounding/facts";
import { draftGroundedReply, type GroundedDraft } from "../grounding/llm";
import { sendWhatsApp, whatsappPlan } from "../whatsapp/twilio";
import { whatsappPaused } from "../env";
import { IN_APP_MAX, sendNow } from "./delivery";
import { startSequences } from "./sequences";
import { routeLead } from "./routing";
import { holdFirstReply, recordFirstReply } from "./response-time";
import { applyCompliance, complianceFor, compliantBody } from "../compliance";
import { composeReply, greetingName } from "../grounding/compose";
import type { AutoReply } from "../store/types";

/**
 * Lead actions — the ONE place sales-side writes happen. Each writes to the
 * premium API (the system of record) and this app's store, and audits it.
 * Called by the new-lead feed, the Twilio webhook and the reps' server
 * actions (which authorize first).
 */

export const AI_SENDER = "ai-auto-reply";

// ─── Assignment ─────────────────────────────────────────────────────────────

export async function assignLead(leadId: string, repId: string, actor: string, reason: string): Promise<void> {
  const reps = await store().listReps();
  if (!reps.some((r) => r.id === repId && r.active)) throw new Error("Unknown or inactive rep.");
  await premium.patchLead(leadId, { assignedTo: repId });
  await store().addAssignment({ id: randomUUID(), leadId, repId, assignedAt: new Date().toISOString(), assignedBy: actor, reason });
  await audit("assigned", leadId, actor, `→ ${repId} (${reason})`);
}

/** Routes by locality + load (lib/automation/routing.ts) and assigns. Returns the rep id, or null if no rep is active. */
export async function autoAssign(leadId: string, locality: string | null): Promise<string | null> {
  const [reps, assignments] = await Promise.all([store().listReps(), store().listAssignments()]);
  // Demo reps (npm run demo:seed) never receive real leads.
  const decision = routeLead(locality, reps.filter((r) => !r.demo), assignments);
  if (!decision) return null;
  await assignLead(leadId, decision.rep.id, "routing", decision.reason);
  return decision.rep.id;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export async function moveLead(leadId: string, change: { stage?: LeadStage; status?: LeadStatus }, actor: string): Promise<void> {
  await premium.patchLead(leadId, change);
  await audit("pipeline", leadId, actor, Object.entries(change).map(([k, v]) => `${k} → ${v}`).join(", "));
}

// ─── Messaging ──────────────────────────────────────────────────────────────

export interface SentMessage {
  channel: Channel;
  delivered: "whatsapp" | "premium-in-app" | "logged-only" | "queued-pending-twilio";
  /** WhatsApp only: Twilio's SID, and whether the approved template went instead of the text. */
  sid: string | null;
  template: boolean;
  /** What the buyer received. */
  body: string;
}

/**
 * SENDS (where this desk can) and LOGS to the premium lead thread.
 *   whatsapp → Twilio (opt-in + 24-hour rules in lib/whatsapp/twilio.ts); logged only after Twilio accepts it
 *   in_app   → the premium app delivers it to the buyer's inbox
 *   sms / email / call → logged only (no SMS without TRAI DLT; calls are made by the rep)
 */
export async function sendMessage(leadId: string, channel: Channel, raw: string, sentBy: string, opts: { ai?: boolean; projectId?: string } = {}): Promise<SentMessage> {
  // A call is a log entry, not a message to the buyer; everything else carries its project's RERA line / exemption (+ AI label).
  const body = channel === "call" ? raw : await compliantBody(leadId, raw, opts);
  const sent = await deliverMessage(leadId, channel, body, sentBy);
  // A rep's own reply counts as the lead's first reply when nothing automated answered first.
  if (sent.delivered !== "queued-pending-twilio" && sentBy !== AI_SENDER) {
    const row = await store().getFirstReply(leadId);
    if (row && !row.firstReplyAt) await recordFirstReply({ leadId, arrivedAt: row.arrivedAt, at: new Date().toISOString(), path: "rep_reply" });
  }
  return sent;
}

async function deliverMessage(leadId: string, channel: Channel, body: string, sentBy: string): Promise<SentMessage> {
  // Twilio is parked: SMS and email always, WhatsApp while paused, are QUEUED — never sent, never logged as sent.
  if (channel === "sms" || channel === "email" || (channel === "whatsapp" && whatsappPaused())) {
    await sendNow(leadId, channel, body, sentBy);
    return { channel, delivered: "queued-pending-twilio", sid: null, template: false, body };
  }
  if (channel === "whatsapp") {
    const sent = await sendWhatsApp(leadId, body, sentBy);
    await audit("whatsapp", leadId, sentBy, `sent ${sent.template ? "approved template" : "free-form"} → ${sent.to} (${sent.sid})`);
    try {
      const logged = await premium.appendMessage(leadId, { channel, body: sent.sentBody, sentBy });
      await store().updateWaMessage(sent.waMessageId, { premiumMessageId: logged.id });
    } catch (error) {
      // Delivered but not logged: the thread shows it from wa_messages; say so loudly.
      await audit("log-failed", leadId, sentBy, `WhatsApp ${sent.sid} sent but not logged to premium: ${error instanceof Error ? error.message : "unknown"}`);
      throw new Error("Sent on WhatsApp, but logging it to the premium thread failed — it shows here, not yet in the premium app.");
    }
    return { channel, delivered: "whatsapp", sid: sent.sid, template: sent.template, body: sent.sentBody };
  }
  await premium.appendMessage(leadId, { channel, body, sentBy });
  return { channel, delivered: channel === "in_app" ? "premium-in-app" : "logged-only", sid: null, template: false, body };
}

export async function takeOver(leadId: string, repId: string): Promise<void> {
  const current = await store().getConversation(leadId);
  await store().setConversation({ leadId, mode: "human", takenOverBy: repId, takenOverAt: new Date().toISOString(), suggestedDraft: current?.suggestedDraft ?? null });
  await audit("takeover", leadId, repId, "rep took over; automation paused");
}

export async function handBack(leadId: string, repId: string): Promise<void> {
  await store().setConversation({ leadId, mode: "ai", takenOverBy: null, takenOverAt: null, suggestedDraft: null });
  await audit("handback", leadId, repId, "automation resumed");
}

// ─── Instant grounded auto-reply ────────────────────────────────────────────

export type AutoReplyResult = { done: true; reply: AutoReply; draft: GroundedDraft; template: boolean } | { done: false; skipped: string };

/**
 * The INSTANT REPLY to a new lead. Idempotent per lead (the store's claim is
 * the lock, so a broadcast and a poll can't double-send).
 *
 *   1. skip if already replied, or a rep has taken over
 *   2. fetch the lead (MASKED) and its property; draft from the fact sheet only
 *   3. WhatsApp free-form IF opted in AND inside the 24-hour window;
 *      otherwise the grounded answer goes IN-APP, and — opted in + template
 *      configured — the approved template on WhatsApp invites them to chat there
 *   4. everything is logged on the premium thread (sentBy ai-auto-reply)
 *   5. nothing answerable → holding reply + hand to a human
 *   6. route the lead to a rep if unassigned
 */
export async function autoReply(leadId: string, trigger: string): Promise<AutoReplyResult> {
  const existing = await store().getAutoReply(leadId);
  if (existing && existing.outcome !== "failed") return { done: false, skipped: `already replied (${existing.outcome})` };
  if ((await store().getConversation(leadId))?.mode === "human") return { done: false, skipped: "a rep has taken over" };

  const lead = await premium.getLead(leadId);
  // The premium thread is the source of truth: an AI reply already there means
  // this lead was answered (e.g. before this desk's store was reset).
  if (lead.messages.some((m) => m.sentBy === AI_SENDER)) return { done: false, skipped: "already replied (premium thread)" };
  const property = await premium.getProperty(lead.propertyId);
  const facts = buildFacts(property);
  const draft = await draftGroundedReply({ kind: lead.kind, message: lead.message, contactName: lead.contact.name }, facts);
  const plan = await whatsappPlan(leadId);
  const freeForm = plan.configured && plan.optedIn && !plan.problem && plan.windowOpen;
  const channel = freeForm ? "whatsapp" : "in_app";

  const reply: AutoReply = {
    leadId,
    outcome: "failed",
    channel,
    engine: draft.engine,
    body: draft.body,
    factKeys: draft.factKeys,
    handoffReason: draft.handoff
      ? "nothing asked is covered by the property data"
      : draft.humanTopics.length > 0
        ? `needs a human for: ${draft.humanTopics.join(", ")}`
        : null,
    providerId: null,
    at: new Date().toISOString(),
  };
  if (existing) await store().updateAutoReply(reply);
  else if (!(await store().claimAutoReply(reply))) return { done: false, skipped: "another worker is replying" };

  // The project's RERA line (or exemption) and, where AI wrote it, the AI label — or nothing goes out.
  const compliance = await complianceFor(lead.propertyId);
  if (!compliance) {
    const note = "no RERA registration number or exemption for this project — add one in Brand settings → Projects";
    await store().updateAutoReply({ ...reply, outcome: "handoff", handoffReason: `instant reply blocked: ${note}` });
    await store().setConversation({ leadId, mode: "human", takenOverBy: null, takenOverAt: null, suggestedDraft: null });
    await holdFirstReply({ leadId, arrivedAt: lead.createdAt, status: "blocked", note });
    await audit("outbound-blocked", leadId, AI_SENDER, `instant reply not sent: ${note}`);
    if (!lead.assignedTo) await autoAssign(leadId, lead.context.property?.locality ?? property.locality);
    return { done: false, skipped: `blocked — ${note}` };
  }
  let body = applyCompliance(draft.body, compliance, { ai: draft.engine === "llm" });
  // In-app is capped at 500 characters: the shorter deterministic answer, then a holding line.
  if (channel === "in_app" && body.length > IN_APP_MAX) body = applyCompliance(composeReply({ kind: lead.kind, message: lead.message, contactName: lead.contact.name }, facts).body, compliance);
  if (channel === "in_app" && body.length > IN_APP_MAX) body = applyCompliance(`Hi${greetingName(lead.contact.name) ? ` ${greetingName(lead.contact.name)}` : ""}, thanks for your interest in ${property.name}. A member of our team will reply shortly.`, compliance);
  reply.body = body;

  try {
    const sent = await sendMessage(leadId, channel, body, AI_SENDER);
    let template = false;
    // Outside the window: the answer went in-app; an approved template can still open WhatsApp.
    if (!freeForm && plan.configured && plan.optedIn && !plan.problem && plan.templateAvailable) {
      try {
        await sendMessage(leadId, "whatsapp", body, AI_SENDER);
        template = true;
      } catch (error) {
        await audit("whatsapp-failed", leadId, AI_SENDER, error instanceof Error ? error.message : "unknown");
      }
    }
    const final: AutoReply = { ...reply, outcome: draft.handoff ? "handoff" : "sent", providerId: sent.sid };
    await store().updateAutoReply(final);
    await recordFirstReply({ leadId, arrivedAt: lead.createdAt, at: new Date().toISOString(), path: "instant_reply", types: draft.handoff ? ["acknowledgement"] : ["acknowledgement", "grounded_answer"] });
    if (draft.handoff) await store().setConversation({ leadId, mode: "human", takenOverBy: null, takenOverAt: null, suggestedDraft: null });
    await audit(
      "auto-reply",
      leadId,
      AI_SENDER,
      `${final.outcome} via ${channel}${template ? " + WhatsApp template" : ""}; ${draft.engine}${draft.fallbackReason ? ` [${draft.fallbackReason}]` : ""}; facts: ${draft.factKeys.join(", ")}; trigger: ${trigger}`,
    );
    if (!lead.assignedTo) await autoAssign(leadId, lead.context.property?.locality ?? property.locality);
    if (!draft.handoff) await startSequences("inquiry_received", leadId, { source: AI_SENDER });
    return { done: true, reply: final, draft, template };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await store().updateAutoReply({ ...reply, handoffReason: `send failed: ${message}` });
    await audit("auto-reply-failed", leadId, AI_SENDER, message);
    throw error;
  }
}

/** A grounded draft answering the buyer's LATEST message — for a rep to edit and send; never sent here. */
export async function draftForRep(leadId: string): Promise<GroundedDraft> {
  const lead = await premium.getLead(leadId);
  const property = await premium.getProperty(lead.propertyId);
  const lastInbound = [...lead.messages].reverse().find((m) => m.direction === "inbound");
  return draftGroundedReply({ kind: lead.kind, message: lastInbound?.body ?? lead.message, contactName: lead.contact.name }, buildFacts(property));
}

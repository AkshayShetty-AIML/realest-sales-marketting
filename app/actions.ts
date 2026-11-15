"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRepForAction } from "@/lib/auth";
import { premium, PremiumError } from "@/lib/premium/client";
import { CHANNELS, LEAD_STAGES, LEAD_STATUSES, UNIT_STATUSES, VISIT_STATUSES } from "@/lib/premium/contract";
import { audit, store } from "@/lib/store";
import { assignLead, autoAssign, autoReply, draftForRep, handBack, moveLead, sendMessage, takeOver } from "@/lib/automation/leads";
import { bookVisit, cancelVisit, checkIn, completeVisit, confirmAttendance, findVisit, markNoShow, VisitError } from "@/lib/automation/visits";
import { startRun, stopRuns } from "@/lib/automation/sequences";
import { sendNow } from "@/lib/automation/delivery";
import { renderFor } from "@/lib/automation/vars";
import { formatDistance } from "@/lib/scheduling/geo";
import type { Sequence } from "@/lib/store/types";
import { randomUUID } from "node:crypto";

import { verifyUnit } from "@/lib/inventory";
import { generateBrochure, sendBrochure } from "@/lib/brochure/generate";
import { SERVICE_IDS } from "@/lib/services/catalog";

/**
 * Every rep action. Each one: (1) requires a signed-in rep, (2) validates its
 * input with zod, (3) calls lib/automation/leads.ts, (4) revalidates the
 * views. Errors come back as { ok: false, error } — never a stack, never a key.
 */

export type ActionResult<T = undefined> = { ok: true; data?: T; note?: string } | { ok: false; error: string };

const LeadId = z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/);

async function run<T>(leadId: string | null, work: (repId: string) => Promise<{ data?: T; note?: string } | void>): Promise<ActionResult<T>> {
  try {
    const rep = await requireRepForAction();
    const result = (await work(rep.repId)) ?? {};
    revalidatePath("/inbox");
    revalidatePath("/pipeline");
    if (leadId) revalidatePath(`/leads/${encodeURIComponent(leadId)}`);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join("; ") };
    if (error instanceof PremiumError) return { ok: false, error: `Premium API: ${error.message}` };
    if (error instanceof VisitError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function assignAction(leadId: string, repId: string) {
  return run(leadId, async (actor) => {
    await assignLead(LeadId.parse(leadId), z.string().min(1).max(120).parse(repId), actor, "assigned by rep");
  });
}

export async function autoRouteAction(leadId: string) {
  return run(leadId, async () => {
    const id = LeadId.parse(leadId);
    const lead = await premium.getLead(id);
    const repId = await autoAssign(id, lead.context.property?.locality ?? null);
    return { note: repId ? `Routed to ${repId}.` : "No active rep to route to." };
  });
}

export async function moveAction(leadId: string, change: { stage?: string; status?: string }) {
  return run(leadId, async (actor) => {
    const parsed = z
      .object({ stage: z.enum(LEAD_STAGES).optional(), status: z.enum(LEAD_STATUSES).optional() })
      .refine((c) => c.stage || c.status, "Choose a stage or a status.")
      .parse(change);
    await moveLead(LeadId.parse(leadId), parsed, actor);
  });
}

export async function sendAction(leadId: string, channel: string, body: string) {
  return run(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const input = z.object({ channel: z.enum(CHANNELS), body: z.string().trim().min(1, "Write a message.").max(1600) }).parse({ channel, body });
    if (input.channel === "in_app" && input.body.length > 500) throw new Error("In-app messages are limited to 500 characters.");
    // A rep writing to the buyer IS a takeover: automation steps back.
    await takeOver(id, actor);
    const sent = await sendMessage(id, input.channel, input.body, actor);
    const note =
      sent.delivered === "whatsapp"
        ? sent.template
          ? "Outside the 24-hour window, so the approved WhatsApp template was sent (not your text) and logged."
          : "Sent on WhatsApp and logged to the premium thread. Delivery status updates below."
        : sent.delivered === "queued-pending-twilio"
          ? `Queued — ${input.channel === "email" ? "email" : input.channel === "sms" ? "SMS" : "WhatsApp"} is pending Twilio (production). Not sent.`
          : sent.delivered === "premium-in-app"
          ? "Delivered to the buyer's in-app inbox."
          : `Logged as ${input.channel}. This app does not send ${input.channel === "call" ? "calls" : input.channel.toUpperCase()} itself.`;
    return { note };
  });
}

export async function draftAction(leadId: string) {
  return run<{ body: string; engine: string; factKeys: string[]; humanTopics: string[]; fallbackReason: string | null }>(leadId, async () => {
    const draft = await draftForRep(LeadId.parse(leadId));
    return { data: { body: draft.body, engine: draft.engine, factKeys: draft.factKeys, humanTopics: draft.humanTopics, fallbackReason: draft.fallbackReason } };
  });
}

export async function takeOverAction(leadId: string) {
  return run(leadId, async (actor) => takeOver(LeadId.parse(leadId), actor));
}

export async function handBackAction(leadId: string) {
  return run(leadId, async (actor) => handBack(LeadId.parse(leadId), actor));
}

export async function autoReplyAction(leadId: string) {
  return run(leadId, async () => {
    const result = await autoReply(LeadId.parse(leadId), "rep-triggered");
    return { note: result.done ? `Instant reply ${result.reply.outcome} via ${result.reply.channel === "in_app" ? "in-app" : "WhatsApp"}${result.template ? " + WhatsApp template" : ""}.` : `Skipped: ${result.skipped}.` };
  });
}

/** A rep records consent the buyer gave them (e.g. on a call). */
export async function optInAction(leadId: string, status: "opted_in" | "opted_out") {
  return run(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const value = z.enum(["opted_in", "opted_out"]).parse(status);
    await store().setOptIn({ leadId: id, channel: "whatsapp", status: value, source: `rep-recorded:${actor}`, recordedAt: new Date().toISOString(), simulated: false });
    await audit("opt-in", id, actor, `WhatsApp ${value}`);
  });
}

/** Unmasked contact for ONE lead, for a rep about to contact them. Audited. */
export async function revealContactAction(leadId: string) {
  return run<{ name: string | null; phone: string | null; email: string | null }>(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const lead = await premium.getLead(id, { includeContact: true });
    await audit("contact-revealed", id, actor, "rep viewed unmasked contact");
    return { data: { name: lead.contact.name, phone: lead.contact.phone, email: lead.contact.email } };
  });
}

export async function bookVisitAction(leadId: string, slot: string, location: string) {
  return run(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const input = z.object({ slot: z.string().min(1, "Pick a date and time."), location: z.string().trim().max(200) }).parse({ slot, location });
    const at = new Date(input.slot);
    if (Number.isNaN(at.getTime())) throw new Error("That date/time isn't valid.");
    const rec = await bookVisit({ leadId: id, slot: at.toISOString(), source: "rep", actor, location: input.location || undefined });
    return { note: `Booked and confirmed for ${new Date(rec.slot).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Confirmation sent in-app; reminders scheduled.` };
  });
}

/** Visit status from the desk — each runs its follow-ups (feedback form, recovery sequence…). */
export async function visitStatusAction(leadId: string, visitId: string, status: string) {
  return run(leadId, async (actor) => {
    const value = z.enum(VISIT_STATUSES).parse(status);
    const id = z.string().min(1).max(160).parse(visitId);
    if (!(await findVisit(id))) {
      // A visit booked before the desk indexed visits: plain status change.
      await premium.patchVisit(id, value);
      return { note: `Visit marked ${value.replace("_", " ")}.` };
    }
    if (value === "completed") await completeVisit(id, actor);
    else if (value === "no_show") await markNoShow(id, actor);
    else if (value === "cancelled") await cancelVisit(id, actor);
    else if (value === "confirmed") await confirmAttendance(id);
    return { note: value === "completed" ? "Visit completed — feedback form sent in-app." : value === "no_show" ? "Marked no-show — recovery sequence started." : `Visit ${value.replace("_", " ")}.` };
  });
}

export async function sendBookingLinkAction(leadId: string) {
  return run(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const lead = await premium.getLead(id);
    const body = await renderFor("Hi {{firstName|there}}, you can pick a time to visit {{property}} here — it's confirmed instantly: {{bookingLink}}", { lead });
    const job = await sendNow(id, "in_app", body, actor);
    if (job.status !== "sent") throw new Error(job.note ?? "Couldn't send the link.");
    return { note: "Booking link sent to the buyer's inbox." };
  });
}

/** The REP checks in at the site (their phone's location) — proof of visit. */
export async function repCheckInAction(leadId: string, visitId: string, lat: number, lng: number, accuracyM: number | null) {
  return run(leadId, async (actor) => {
    const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100_000).nullable() }).parse({ lat, lng, accuracyM });
    const c = await checkIn({ visitId: z.string().min(1).max(160).parse(visitId), by: actor, ...coords });
    return { note: c.onSite ? `Checked in on site (${formatDistance(c.distanceM)} from the property). Visit completed; feedback form sent.` : `Recorded, but you're ${formatDistance(c.distanceM)} from the property — not counted as on site.` };
  });
}

export async function startSequenceAction(leadId: string, sequenceId: string) {
  return run(leadId, async (actor) => {
    const id = LeadId.parse(leadId);
    const seq = (await store().listSequences()).find((s) => s.id === sequenceId);
    if (!seq) throw new Error("Unknown sequence.");
    if (seq.trigger === "visit_booked") throw new Error("Pre-visit sequences start when a visit is booked.");
    if ((await store().listRuns({ leadId: id, status: "active" })).some((r) => r.sequenceId === seq.id)) throw new Error("That sequence is already running for this lead.");
    await startRun(seq, id, { source: actor });
    return { note: `Started “${seq.name}”.` };
  });
}

export async function stopRunAction(leadId: string, runId: string) {
  return run(leadId, async (actor) => {
    const n = await stopRuns(LeadId.parse(leadId), `stopped by ${actor}`, { runId: z.string().min(1).parse(runId) });
    return { note: n ? "Sequence stopped; its remaining steps are cancelled." : "Nothing to stop." };
  });
}

// ─── Sequence builder ───────────────────────────────────────────────────────

const SequenceInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  name: z.string().trim().min(2, "Give the sequence a name.").max(80),
  trigger: z.enum(["inquiry_received", "no_reply", "cold_lead", "visit_booked", "visit_no_show", "feedback_interested", "feedback_objection"]),
  params: z.object({
    afterHours: z.number().min(1).max(720).optional(),
    afterDays: z.number().min(1).max(180).optional(),
    objection: z.enum(["price", "location", "size_layout", "possession", "amenities", "other"]).optional(),
  }),
  active: z.boolean(),
  stopOnReply: z.boolean(),
  steps: z
    .array(
      z.object({
        offsetHours: z.number().min(-336).max(2160),
        channel: z.enum(["in_app", "whatsapp", "sms", "email"]),
        template: z.string().trim().min(5, "Every step needs a message.").max(480, "Keep each message under 480 characters (in-app limit, with room for links)."),
      }),
    )
    .min(1, "Add at least one step.")
    .max(10),
});

export async function saveSequenceAction(input: unknown) {
  return run<{ id: string }>(null, async () => {
    const parsed = SequenceInput.parse(input);
    if (parsed.trigger !== "visit_booked" && parsed.steps.some((s) => s.offsetHours < 0)) throw new Error("Only pre-visit sequences can have steps before their trigger.");
    if (parsed.trigger === "feedback_objection" && !parsed.params.objection) throw new Error("Choose which objection this nudge answers.");
    const seq: Sequence = { ...parsed, id: parsed.id ?? `seq-${randomUUID().slice(0, 8)}`, updatedAt: new Date().toISOString() };
    await store().upsertSequence(seq);
    revalidatePath("/sequences");
    return { data: { id: seq.id }, note: "Saved. Changes apply to runs that start from now." };
  });
}

export async function toggleSequenceAction(id: string, active: boolean) {
  return run(null, async () => {
    const seq = (await store().listSequences()).find((s) => s.id === id);
    if (!seq) throw new Error("Unknown sequence.");
    await store().upsertSequence({ ...seq, active, updatedAt: new Date().toISOString() });
    revalidatePath("/sequences");
  });
}

export async function deleteSequenceAction(id: string) {
  return run(null, async () => {
    const running = (await store().listRuns({ status: "active" })).filter((r) => r.sequenceId === id);
    for (const r of running) await stopRuns(r.leadId, "sequence deleted", { runId: r.id });
    await store().deleteSequence(z.string().min(1).parse(id));
    revalidatePath("/sequences");
  });
}

export async function saveVisitSettingsAction(input: unknown) {
  return run(null, async () => {
    const parsed = z
      .object({
        daysAhead: z.number().int().min(1).max(60),
        startHour: z.number().int().min(6).max(21),
        endHour: z.number().int().min(7).max(22),
        slotMinutes: z.number().int().refine((n) => [30, 45, 60, 90, 120].includes(n), "Slot length must be 30, 45, 60, 90 or 120 minutes."),
        capacityPerSlot: z.number().int().min(1).max(20),
        closedWeekdays: z.array(z.number().int().min(0).max(6)).max(6),
        minNoticeHours: z.number().int().min(0).max(72),
      })
      .refine((v) => v.endHour > v.startHour, "Closing time must be after opening time.")
      .parse(input);
    await store().setVisitSettings(parsed);
    revalidatePath("/visits");
    return { note: "Visit hours saved. The booking page uses them immediately." };
  });
}

export async function unitStatusAction(leadId: string, unitId: string, status: string) {
  return run(leadId, async (actor) => {
    const result = await verifyUnit({ unitId: z.string().min(1).max(160).parse(unitId), status: z.enum(UNIT_STATUSES).parse(status), lastVerifiedAt: new Date().toISOString(), actor, leadId: LeadId.parse(leadId) });
    if (!result.ok) throw new Error(result.conflict ? `Not saved: a newer check is already recorded (${result.message}).` : result.message);
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
  });
}

/**
 * Inventory page: a rep's verification. `verifiedAt` defaults to now; an
 * earlier time (e.g. recording yesterday's site check) is allowed — and if
 * premium already holds a NEWER check, premium refuses it (409) and we say so.
 */
export async function verifyUnitAction(unitId: string, status: string, verifiedAt: string | null) {
  return run(null, async (actor) => {
    const at = verifiedAt ? z.string().datetime({ offset: true }).parse(verifiedAt) : new Date().toISOString();
    const result = await verifyUnit({ unitId: z.string().min(1).max(160).parse(unitId), status: z.enum(UNIT_STATUSES).parse(status), lastVerifiedAt: at, actor });
    if (!result.ok) throw new Error(result.conflict ? `Not saved: a newer check is already recorded (${result.message}). Nothing changed.` : result.message);
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { note: `Saved — ${unitId} is ${result.unit.status}, verified ${new Date(result.unit.lastVerifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST.` };
  });
}

// ─── Brochures ──────────────────────────────────────────────────────────────

export async function generateBrochureAction(leadId: string) {
  return run(leadId, async (actor) => {
    const b = await generateBrochure(LeadId.parse(leadId), actor);
    return { data: b.id, note: b.engine === "llm" ? "Brochure ready — written by AI from the property facts." : "Brochure ready." };
  });
}

export async function sendBrochureAction(leadId: string, brochureId: string, channel: string) {
  return run(leadId, async (actor) => {
    const ch = z.enum(["in_app", "whatsapp", "email"]).parse(channel);
    const id = z.string().uuid().parse(brochureId);
    const existing = await store().getBrochure(id);
    if (!existing || existing.leadId !== LeadId.parse(leadId)) throw new Error("That brochure isn't for this lead.");
    const b = await sendBrochure(id, ch, actor);
    const last = b.deliveries.at(-1);
    if (last?.status === "failed") throw new Error(last.note ?? "Send failed.");
    return { note: last?.status === "pending_twilio" ? `Saved — it goes out on ${ch === "email" ? "email" : "WhatsApp"} once that channel is set up.` : "Sent to the buyer's in-app inbox." };
  });
}

// ─── Builder services (OPS-29) ──────────────────────────────────────────────

/** "Tell me when it's ready" — records this person's interest in one service, once. No other fields. */
export async function registerServiceInterestAction(service: unknown): Promise<ActionResult> {
  return run(null, async (repId) => {
    const id = z.enum(SERVICE_IDS).parse(service);
    if (!(await store().listServiceInterests()).some((x) => x.service === id && x.repId === repId)) await store().addServiceInterest({ id: randomUUID(), service: id, repId, at: new Date().toISOString() });
    revalidatePath("/services");
    return { note: "We'll tell you when it's ready." };
  });
}

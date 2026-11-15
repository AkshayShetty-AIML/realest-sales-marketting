import "server-only";
import { randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import type { Visit } from "../premium/contract";
import { audit, store } from "../store";
import type { CheckIn, Feedback, Interest, Objection, VisitRecord, VisitSettings } from "../store/types";
import { DEFAULT_VISIT_SETTINGS, isBookable } from "../scheduling/slots";
import { distanceMeters, formatDistance, isOnSite } from "../scheduling/geo";
import { formatIst } from "../scheduling/time";
import { sendNow } from "./delivery";
import { renderFor } from "./vars";
import { startSequences, stopNudges, stopRuns } from "./sequences";
import { moveLead } from "./leads";

/**
 * SITE VISITS, end to end, through the premium contract only:
 *   create  → POST /visits (premium moves the stage to visit_scheduled)
 *   status  → PATCH /visits/:id (scheduled → confirmed → completed / cancelled / no_show)
 * The desk keeps an index (VisitRecord) for capacity and reminders, sends the
 * buyer in_app confirmations, starts/stops sequences, records geotag
 * check-ins as proof of visit, and turns post-visit feedback into next steps.
 */

export async function visitSettings(): Promise<VisitSettings> {
  return (await store().getVisitSettings()) ?? DEFAULT_VISIT_SETTINGS;
}

async function record(visit: Visit, propertyId: string, source: VisitRecord["source"]): Promise<VisitRecord> {
  const now = new Date().toISOString();
  const existing = (await store().listVisits({ leadId: visit.leadId })).find((v) => v.visitId === visit.id);
  const rec: VisitRecord = {
    visitId: visit.id,
    leadId: visit.leadId,
    propertyId,
    slot: visit.slot,
    status: visit.status,
    source: existing?.source ?? source,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store().upsertVisit(rec);
  return rec;
}

export async function findVisit(visitId: string): Promise<VisitRecord | null> {
  return (await store().listVisits()).find((v) => v.visitId === visitId) ?? null;
}

// ─── Book / reschedule / cancel / confirm ───────────────────────────────────

export class VisitError extends Error {}

/**
 * Books a slot and AUTO-CONFIRMS it: POST /visits, then PATCH → confirmed.
 * Re-checks the slot server-side, ends nudge sequences, starts pre-visit
 * reminders (relative to the slot), and sends the in_app confirmation.
 */
export async function bookVisit(input: { leadId: string; slot: string; source: VisitRecord["source"]; actor: string; location?: string }): Promise<VisitRecord> {
  const lead = await premium.getLead(input.leadId);
  const settings = await visitSettings();
  const booked = await store().listVisits({ propertyId: lead.propertyId });
  if (!isBookable(input.slot, new Date(), settings, lead.propertyId, booked)) throw new VisitError("That slot is no longer available — please pick another.");
  const property = lead.context.property;
  const created = await premium.createVisit({
    leadId: lead.id,
    slot: new Date(input.slot).toISOString(),
    location: input.location ?? (property ? `Site office, ${property.name}` : undefined),
    createdBy: input.actor,
  });
  const confirmed = await premium.patchVisit(created.id, "confirmed");
  const rec = await record(confirmed, lead.propertyId, input.source);
  await audit("visit-booked", lead.id, input.actor, `${formatIst(rec.slot)} · auto-confirmed (${input.source})`);

  await stopNudges(lead.id);
  await startSequences("visit_booked", lead.id, { visitId: rec.visitId, anchorAt: rec.slot, source: input.actor });
  const fresh = await premium.getLead(lead.id);
  const body = await renderFor(
    "Your visit to {{property}} is confirmed for {{visitTime}} (IST). Need to change it, or checking in on the day? Use this link: {{visitLink}}",
    { lead: fresh, visitId: rec.visitId },
  );
  await sendNow(lead.id, "in_app", body, "visit-confirmation");
  return rec;
}

export async function rescheduleVisit(visitId: string, slot: string, actor: string): Promise<VisitRecord> {
  const old = await findVisit(visitId);
  if (!old) throw new VisitError("Visit not found.");
  if (!["scheduled", "confirmed"].includes(old.status)) throw new VisitError(`A ${old.status.replace("_", " ")} visit can't be rescheduled — book a new one.`);
  const settings = await visitSettings();
  const booked = await store().listVisits({ propertyId: old.propertyId });
  if (!isBookable(slot, new Date(), settings, old.propertyId, booked, visitId)) throw new VisitError("That slot is no longer available — please pick another.");
  // Premium visits can't move: cancel the old one, book the new one.
  const cancelled = await premium.patchVisit(visitId, "cancelled");
  await record(cancelled, old.propertyId, old.source);
  await stopRuns(old.leadId, "visit rescheduled", { visitId });
  await audit("visit-rescheduled", old.leadId, actor, `${formatIst(old.slot)} → ${formatIst(slot)}`);
  return bookVisit({ leadId: old.leadId, slot, source: "reschedule", actor });
}

export async function cancelVisit(visitId: string, actor: string): Promise<void> {
  const v = await findVisit(visitId);
  if (!v) throw new VisitError("Visit not found.");
  const updated = await premium.patchVisit(visitId, "cancelled");
  await record(updated, v.propertyId, v.source);
  await stopRuns(v.leadId, "visit cancelled", { visitId });
  await audit("visit-cancelled", v.leadId, actor, formatIst(v.slot));
  const lead = await premium.getLead(v.leadId);
  await sendNow(v.leadId, "in_app", await renderFor("Your visit to {{property}} is cancelled. Whenever you're ready, pick a new time here: {{bookingLink}}", { lead }), "visit-cancellation");
}

/** The buyer taps "I'll be there". Premium: scheduled → confirmed (already confirmed is fine). */
export async function confirmAttendance(visitId: string): Promise<void> {
  const v = await findVisit(visitId);
  if (!v) throw new VisitError("Visit not found.");
  if (v.status === "scheduled") await record(await premium.patchVisit(visitId, "confirmed"), v.propertyId, v.source);
  await audit("visit-attendance-confirmed", v.leadId, "visitor", formatIst(v.slot));
}

// ─── Check-in, completion, no-show ──────────────────────────────────────────

export async function checkIn(input: { visitId: string; by: string; lat: number; lng: number; accuracyM: number | null }): Promise<CheckIn> {
  const v = await findVisit(input.visitId);
  if (!v) throw new VisitError("Visit not found.");
  if (!["scheduled", "confirmed", "completed"].includes(v.status)) throw new VisitError(`This visit is ${v.status.replace("_", " ")}.`);
  const property = await premium.getProperty(v.propertyId);
  const distanceM = distanceMeters({ lat: input.lat, lng: input.lng }, property.coords);
  const c: CheckIn = {
    id: randomUUID(),
    visitId: v.visitId,
    leadId: v.leadId,
    by: input.by,
    // ~1 m precision is plenty for proof of visit.
    lat: Math.round(input.lat * 1e5) / 1e5,
    lng: Math.round(input.lng * 1e5) / 1e5,
    accuracyM: input.accuracyM === null ? null : Math.round(input.accuracyM),
    at: new Date().toISOString(),
    distanceM,
    onSite: isOnSite(distanceM, input.accuracyM),
  };
  await store().addCheckIn(c);
  await audit("check-in", v.leadId, input.by, `${c.onSite ? "on site" : "NOT on site"} · ${formatDistance(distanceM)} from ${property.name}${c.accuracyM !== null ? ` (±${c.accuracyM} m)` : ""}`);
  if (c.onSite && v.status !== "completed") await completeVisit(v.visitId, `check-in:${input.by}`);
  return c;
}

/** PATCH → completed (premium moves the stage to visit_done), then the feedback form goes out in_app. */
export async function completeVisit(visitId: string, actor: string): Promise<void> {
  const v = await findVisit(visitId);
  if (!v) throw new VisitError("Visit not found.");
  if (v.status === "completed") return;
  const updated = await premium.patchVisit(visitId, "completed");
  await record(updated, v.propertyId, v.source);
  await stopRuns(v.leadId, "visit completed", { visitId });
  await audit("visit-completed", v.leadId, actor, formatIst(v.slot));
  const lead = await premium.getLead(v.leadId);
  const body = await renderFor(
    "Thanks for visiting {{property}}! How did it go? Two quick questions help us help you: {{feedbackLink}}",
    { lead, visitId },
  );
  await sendNow(v.leadId, "in_app", body, "feedback-request");
}

/** `now` = when it was noticed: recovery steps are timed from then (not from whenever this code happened to run). */
export async function markNoShow(visitId: string, actor: string, now = new Date()): Promise<void> {
  const v = await findVisit(visitId);
  if (!v) throw new VisitError("Visit not found.");
  if (!["scheduled", "confirmed"].includes(v.status)) return;
  const updated = await premium.patchVisit(visitId, "no_show");
  await record(updated, v.propertyId, v.source);
  await stopRuns(v.leadId, "visit marked no-show", { visitId });
  await audit("visit-no-show", v.leadId, actor, formatIst(v.slot));
  await startSequences("visit_no_show", v.leadId, { visitId, source: actor }, now);
}

/** A visit this many hours past its slot with no on-site check-in is a no-show. */
export const NO_SHOW_AFTER_HOURS = 3;

export async function detectNoShows(now = new Date()): Promise<number> {
  const checkIns = await store().listCheckIns();
  let n = 0;
  for (const v of await store().listVisits()) {
    if (!["scheduled", "confirmed"].includes(v.status)) continue;
    if (Date.parse(v.slot) + NO_SHOW_AFTER_HOURS * 3_600_000 > now.getTime()) continue;
    if (checkIns.some((c) => c.visitId === v.visitId && c.onSite)) continue;
    await markNoShow(v.visitId, "scheduler", now);
    n += 1;
  }
  return n;
}

// ─── Post-visit feedback → next step ────────────────────────────────────────

export async function submitFeedback(input: { visitId: string; leadId: string; interest: Interest; objections: Objection[]; rating: number | null; comment: string }): Promise<Feedback> {
  const actions: string[] = [];
  const lead = await premium.getLead(input.leadId);
  if (input.interest === "interested") {
    await moveLead(lead.id, { stage: "negotiation", status: "in_progress" }, "feedback");
    actions.push("stage → negotiation, status → in progress");
    const runs = await startSequences("feedback_interested", lead.id, { visitId: input.visitId, source: "feedback" });
    if (runs.length) actions.push("started the “interested” follow-up");
  }
  for (const objection of input.objections.slice(0, 2)) {
    const runs = await startSequences("feedback_objection", lead.id, { visitId: input.visitId, objection, source: "feedback" });
    if (runs.length) actions.push(`started the “${objection}” nudge`);
  }
  if (input.interest !== "interested" && input.objections.length === 0) {
    const runs = await startSequences("feedback_objection", lead.id, { visitId: input.visitId, objection: "other", source: "feedback" });
    if (runs.length) actions.push("started the “anything else” nudge");
  }
  if (input.interest === "not_interested") {
    await moveLead(lead.id, { status: "on_hold" }, "feedback");
    actions.push("status → on hold (a rep decides whether it's lost)");
  }
  const fb: Feedback = { id: randomUUID(), ...input, comment: input.comment.slice(0, 1000), at: new Date().toISOString(), actions };
  await store().addFeedback(fb);
  await audit("feedback", lead.id, "visitor", `${input.interest}${input.objections.length ? ` · ${input.objections.join(", ")}` : ""}${input.rating ? ` · ${input.rating}/5` : ""} → ${actions.join("; ") || "no automatic step"}`);
  return fb;
}

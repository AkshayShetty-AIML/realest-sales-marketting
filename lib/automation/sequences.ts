import "server-only";
import { randomUUID } from "node:crypto";
import { audit, store } from "../store";
import type { Job, Objection, Sequence, SequenceRun, SequenceTrigger } from "../store/types";

/**
 * FOLLOW-UP SEQUENCES — trigger + steps + delays. Starting a run schedules
 * every step as a Job up front (lib/automation/engine.ts executes them when
 * due, re-checking stop rules each time). One active run per sequence per
 * lead. in_app steps are delivered; whatsapp/sms/email steps are queued
 * "pending Twilio (production)".
 */

export const TRIGGER_LABEL: Record<SequenceTrigger, string> = {
  inquiry_received: "New inquiry (after the instant reply)",
  no_reply: "No reply to our last message",
  cold_lead: "Cold lead (no activity)",
  visit_booked: "Visit booked (times relative to the visit)",
  visit_no_show: "Visit marked no-show",
  feedback_interested: "Post-visit feedback: interested",
  feedback_objection: "Post-visit feedback: objection",
  campaign_enrolled: "Campaign enrolment (marketing workspace · per archetype)",
};

export const OBJECTION_LABEL: Record<Objection, string> = {
  price: "Price",
  location: "Location",
  size_layout: "Size / layout",
  possession: "Possession timeline",
  amenities: "Amenities",
  other: "Something else",
};

/** Triggers that should stop when a visit gets booked — the nudging worked. */
const NUDGE_TRIGGERS: SequenceTrigger[] = ["inquiry_received", "no_reply", "cold_lead", "visit_no_show"];

// ─── Defaults (seeded; reps edit them on /sequences) ────────────────────────

export const DEFAULT_SEQUENCES: Sequence[] = [
  {
    id: "seq-post-inquiry",
    name: "Post-inquiry follow-up",
    trigger: "inquiry_received",
    params: {},
    active: true,
    stopOnReply: true,
    steps: [
      { offsetHours: 4, channel: "in_app", template: "Hi {{firstName|there}}, did my earlier reply about {{property}} help? If you'd like to see it in person, pick a visit slot here: {{bookingLink}}" },
      { offsetHours: 24, channel: "whatsapp", template: "Hi {{firstName|there}}, following up on {{property}} in {{locality}}. Book a site visit: {{bookingLink}}" },
      { offsetHours: 72, channel: "in_app", template: "Still thinking about {{property}}? Visit slots are open this week: {{bookingLink}} — or reply here with any question." },
    ],
  },
  {
    id: "seq-no-reply",
    name: "No-reply nudge",
    trigger: "no_reply",
    params: { afterHours: 48 },
    active: true,
    stopOnReply: true,
    steps: [{ offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, just checking in on {{property}}. Happy to answer anything here, or you can book a visit: {{bookingLink}}" }],
  },
  {
    id: "seq-pre-visit",
    name: "Pre-visit reminders",
    trigger: "visit_booked",
    params: {},
    active: true,
    stopOnReply: false,
    steps: [
      { offsetHours: -24, channel: "in_app", template: "Reminder: your visit to {{property}} is tomorrow, {{visitTime}}. Need a different time? Reschedule in one tap: {{visitLink}}" },
      { offsetHours: -2, channel: "in_app", template: "See you soon at {{property}} ({{visitTime}}). When you arrive, check in here: {{visitLink}}" },
      { offsetHours: -2, channel: "whatsapp", template: "Your visit to {{property}} is at {{visitTime}}. Manage it here: {{visitLink}}" },
    ],
  },
  {
    id: "seq-no-show",
    name: "No-show recovery",
    trigger: "visit_no_show",
    params: {},
    active: true,
    stopOnReply: true,
    steps: [
      { offsetHours: 1, channel: "in_app", template: "Sorry we missed you at {{property}} today. No problem — pick another time that suits you: {{bookingLink}}" },
      { offsetHours: 48, channel: "in_app", template: "Hi {{firstName|there}}, {{property}} is still open for visits. Choose a slot here: {{bookingLink}}" },
      { offsetHours: 48, channel: "email", template: "We missed you at {{property}} — reschedule your visit: {{bookingLink}}" },
    ],
  },
  {
    id: "seq-cold",
    name: "Cold-lead reactivation",
    trigger: "cold_lead",
    params: { afterDays: 14 },
    active: true,
    stopOnReply: true,
    steps: [
      { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, it's been a while since you asked about {{property}}. It's {{possession|still available to view}}. Want to take another look? {{bookingLink}}" },
      { offsetHours: 0, channel: "email", template: "Still looking? {{property}} in {{locality}} — book a visit: {{bookingLink}}" },
    ],
  },
  {
    id: "seq-interested",
    name: "After visit: interested",
    trigger: "feedback_interested",
    params: {},
    active: true,
    stopOnReply: true,
    steps: [
      { offsetHours: 0, channel: "in_app", template: "Thanks for visiting {{property}}, {{firstName|and for your feedback}}! {{repName|A colleague}} will reach out here to walk you through next steps — documents, payment schedule and booking." },
      { offsetHours: 48, channel: "in_app", template: "Hi {{firstName|there}}, any questions about {{property}} we can answer before you decide? Reply here anytime." },
    ],
  },
  {
    id: "seq-objection-price",
    name: "Objection: price",
    trigger: "feedback_objection",
    params: { objection: "price" },
    active: true,
    stopOnReply: true,
    steps: [{ offsetHours: 2, channel: "in_app", template: "Thanks for the honest feedback on price. {{property}} is listed at {{price|its current listed price}} ({{pricePerSqft|per sq ft on request}}). {{repName|A colleague}} can walk you through the payment schedule — reply here and we'll set up a call." }],
  },
  {
    id: "seq-objection-location",
    name: "Objection: location",
    trigger: "feedback_objection",
    params: { objection: "location" },
    active: true,
    stopOnReply: true,
    steps: [{ offsetHours: 2, channel: "in_app", template: "Thanks for the feedback on location. If it helps, we can share the commute and neighbourhood details for {{locality|the area}} here — just reply with where you travel to most." }],
  },
  {
    id: "seq-objection-other",
    name: "Objection: anything else",
    trigger: "feedback_objection",
    params: { objection: "other" },
    active: true,
    stopOnReply: true,
    steps: [{ offsetHours: 2, channel: "in_app", template: "Thanks for telling us what didn't fit about {{property}}. {{repName|A colleague}} will follow up here — and if another home would suit you better, we'll suggest it." }],
  },
];

// ─── Runs ───────────────────────────────────────────────────────────────────

export interface StartContext {
  visitId?: string | null;
  /** visit_booked: steps are relative to this (the slot). */
  anchorAt?: string;
  objection?: Objection;
  source: string;
}

/** Starts every ACTIVE sequence for this trigger (one active run each). Returns the runs started. */
export async function startSequences(trigger: SequenceTrigger, leadId: string, ctx: StartContext, now = new Date()): Promise<SequenceRun[]> {
  const sequences = (await store().listSequences()).filter(
    (s) => s.active && s.trigger === trigger && (trigger !== "feedback_objection" || s.params.objection === ctx.objection),
  );
  const active = await store().listRuns({ leadId, status: "active" });
  const started: SequenceRun[] = [];
  for (const seq of sequences) {
    if (active.some((r) => r.sequenceId === seq.id && (r.visitId ?? null) === (ctx.visitId ?? null))) continue;
    started.push(await startRun(seq, leadId, ctx, now));
  }
  return started;
}

export async function startRun(seq: Sequence, leadId: string, ctx: StartContext, now = new Date()): Promise<SequenceRun> {
  const anchor = ctx.anchorAt ?? now.toISOString();
  const run: SequenceRun = {
    id: randomUUID(),
    sequenceId: seq.id,
    leadId,
    startedAt: now.toISOString(),
    anchorAt: anchor,
    visitId: ctx.visitId ?? null,
    status: "active",
    stopReason: null,
  };
  await store().upsertRun(run);
  let scheduled = 0;
  for (const [i, step] of seq.steps.entries()) {
    const due = Date.parse(anchor) + step.offsetHours * 3_600_000;
    // A reminder whose moment has already passed (booked at short notice) is skipped, not sent late.
    const late = due < now.getTime() - 60_000;
    const job: Job = {
      id: randomUUID(),
      leadId,
      runId: run.id,
      sequenceId: seq.id,
      stepIndex: i,
      channel: step.channel,
      template: step.template,
      body: null,
      runAt: new Date(Math.max(due, now.getTime())).toISOString(),
      status: late && seq.trigger === "visit_booked" ? "skipped" : "pending",
      note: late && seq.trigger === "visit_booked" ? "skipped: its time had passed when the visit was booked" : null,
      premiumMessageId: null,
      createdAt: now.toISOString(),
      executedAt: null,
      source: `sequence:${seq.id}`,
    };
    if (job.status === "pending") scheduled += 1;
    await store().upsertJob(job);
  }
  if (scheduled === 0) await store().upsertRun({ ...run, status: "completed" });
  await audit("sequence-started", leadId, ctx.source, `${seq.name} (${scheduled} step${scheduled === 1 ? "" : "s"} scheduled)`);
  return run;
}

/** Stops runs (and cancels their pending steps). `only` narrows by trigger or visit. */
export async function stopRuns(
  leadId: string,
  reason: string,
  only: { triggers?: SequenceTrigger[]; visitId?: string; runId?: string } = {},
): Promise<number> {
  const sequences = new Map((await store().listSequences()).map((s) => [s.id, s]));
  const runs = (await store().listRuns({ leadId, status: "active" })).filter(
    (r) =>
      (!only.runId || r.id === only.runId) &&
      (!only.visitId || r.visitId === only.visitId) &&
      (!only.triggers || only.triggers.includes(sequences.get(r.sequenceId)?.trigger as SequenceTrigger)),
  );
  if (runs.length === 0) return 0;
  const ids = new Set(runs.map((r) => r.id));
  for (const job of await store().listJobs({ leadId, status: "pending" })) {
    if (job.runId && ids.has(job.runId)) await store().upsertJob({ ...job, status: "cancelled", note: `cancelled: ${reason}` });
  }
  for (const run of runs) await store().upsertRun({ ...run, status: "stopped", stopReason: reason });
  await audit("sequence-stopped", leadId, "scheduler", `${runs.map((r) => sequences.get(r.sequenceId)?.name ?? r.sequenceId).join(", ")}: ${reason}`);
  return runs.length;
}

/** A booked visit ends the nudging. */
export const stopNudges = (leadId: string) => stopRuns(leadId, "a visit was booked", { triggers: NUDGE_TRIGGERS });

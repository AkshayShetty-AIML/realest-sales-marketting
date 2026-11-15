import "server-only";
import { alertOverdueFirstReplies } from "./response-time";
import { premium } from "../premium/client";
import { audit, store } from "../store";
import type { Job, Sequence } from "../store/types";
import { nextSendable } from "../scheduling/time";
import { deliver } from "./delivery";
import { renderFor } from "./vars";
import { startRun } from "./sequences";
import { detectNoShows } from "./visits";

/**
 * THE SCHEDULER. Every TICK_MS:
 *   1. sweeps (every SWEEP_MS): no-shows, unanswered leads (no_reply), cold leads
 *   2. runs every due job, re-checking — at send time, not at schedule time —
 *      whether it should still go:
 *        · lead won / lost                 → cancelled
 *        · its run was stopped              → cancelled
 *        · buyer replied since the run began and the sequence stops on reply → run stopped
 *        · a rep has taken the conversation → run stopped (automation steps back)
 *        · quiet hours (20:00–09:00 IST)    → moved to 09:00
 *        · more than MAX_PER_DAY automated messages to this lead in 24 h → deferred
 * `now` is injectable so the whole thing is testable with a moved clock.
 */

const TICK_MS = 30_000;
const SWEEP_MS = 5 * 60_000;
const MAX_PER_DAY = 3;
const CAP_DEFER_HOURS = 4;

interface Holder {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastTickAt: string | null;
  lastSweepAt: number;
  lastError: string | null;
}
const KEY = "__salesEngine";
const g = globalThis as unknown as Record<string, Holder | undefined>;
const holder = (): Holder => (g[KEY] ??= { timer: null, running: false, lastTickAt: null, lastSweepAt: 0, lastError: null });

export function engineStatus() {
  const { timer, lastTickAt, lastError } = holder();
  return { on: Boolean(timer), lastTickAt, lastError, everySeconds: TICK_MS / 1000 };
}

// ─── Executing one job ──────────────────────────────────────────────────────

export type JobOutcome = "sent" | "pending_twilio" | "cancelled" | "deferred" | "stopped" | "failed" | "busy";

export async function executeJob(job: Job, now = new Date()): Promise<JobOutcome> {
  if (!(await store().claimJob(job.id))) return "busy";
  const release = (patch: Partial<Job>) => store().upsertJob({ ...job, ...patch });
  try {
    const lead = await premium.getLead(job.leadId);
    if (lead.status === "won" || lead.status === "lost") {
      await release({ status: "cancelled", note: `cancelled: lead is ${lead.status}`, executedAt: now.toISOString() });
      return "cancelled";
    }
    const run = job.runId ? (await store().listRuns({ leadId: job.leadId })).find((r) => r.id === job.runId) : null;
    if (run && run.status !== "active") {
      await release({ status: "cancelled", note: `cancelled: sequence ${run.status}${run.stopReason ? ` (${run.stopReason})` : ""}`, executedAt: now.toISOString() });
      return "cancelled";
    }
    const seq = job.sequenceId ? (await store().listSequences()).find((s) => s.id === job.sequenceId) : null;
    // Marketing nurture is sent ONLY through the marketing harness (one approval per step). Never here, never silently.
    if (seq?.trigger === "campaign_enrolled") {
      await release({ status: "cancelled", note: "cancelled: marketing nurture is sent only through the approval-gated marketing send path", executedAt: now.toISOString() });
      await audit("nurture-job-refused", job.leadId, "scheduler", `${seq.name} step ${(job.stepIndex ?? 0) + 1}: not sent by the sales engine — nurture steps go through the marketing approval path`);
      return "cancelled";
    }
    if (run && seq) {
      const replied = lead.messages.some((m) => m.direction === "inbound" && m.createdAt > run.startedAt);
      const stop = seq.stopOnReply && replied ? "the buyer replied" : (await store().getConversation(job.leadId))?.mode === "human" ? "a rep took over the conversation" : null;
      if (stop) {
        await store().upsertRun({ ...run, status: "stopped", stopReason: stop });
        for (const j of await store().listJobs({ leadId: job.leadId, status: "pending" })) {
          if (j.runId === run.id) await store().upsertJob({ ...j, status: "cancelled", note: `cancelled: ${stop}` });
        }
        await release({ status: "cancelled", note: `cancelled: ${stop}`, executedAt: now.toISOString() });
        await audit("sequence-stopped", job.leadId, "scheduler", `${seq.name}: ${stop}`);
        return "stopped";
      }
    }
    const sendable = nextSendable(now);
    if (sendable.getTime() > now.getTime()) {
      await release({ status: "pending", runAt: sendable.toISOString(), note: "deferred: quiet hours (20:00–09:00 IST)" });
      return "deferred";
    }
    if (job.channel === "in_app" && job.source.startsWith("sequence:")) {
      const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
      const recent = (await store().listJobs({ leadId: job.leadId, status: "sent" })).filter((j) => j.source.startsWith("sequence:") && (j.executedAt ?? "") > dayAgo);
      if (recent.length >= MAX_PER_DAY) {
        await release({ status: "pending", runAt: new Date(now.getTime() + CAP_DEFER_HOURS * 3_600_000).toISOString(), note: `deferred: already ${MAX_PER_DAY} automated messages in 24 h` });
        return "deferred";
      }
    }

    const body = await renderFor(job.template, { lead, visitId: run?.visitId ?? null });
    const result = await deliver(job.leadId, job.channel, body, job.source.startsWith("sequence:") ? `sequence:${seq?.name ?? job.sequenceId}` : job.source);
    await release({ status: result.status, body, note: result.note, premiumMessageId: result.premiumMessageId, executedAt: now.toISOString() });
    if (run) {
      const left = (await store().listJobs({ leadId: job.leadId, status: "pending" })).some((j) => j.runId === run.id);
      if (!left) await store().upsertRun({ ...run, status: "completed" });
    }
    await audit(result.status === "sent" ? "sent" : result.status === "pending_twilio" ? "queued" : "send-failed", job.leadId, "scheduler", `${seq?.name ?? job.source} · ${job.channel}${result.note ? ` · ${result.note}` : ""}`);
    return result.status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await release({ status: "failed", note: message, executedAt: now.toISOString() });
    return "failed";
  }
}

/** Runs every job due at `now`. */
export async function runDueJobs(now = new Date()): Promise<Record<JobOutcome, number>> {
  const counts = { sent: 0, pending_twilio: 0, cancelled: 0, deferred: 0, stopped: 0, failed: 0, busy: 0 } as Record<JobOutcome, number>;
  for (const job of await store().listJobs({ status: "pending", dueBefore: now.toISOString() })) counts[await executeJob(job, now)] += 1;
  return counts;
}

// ─── Sweeps: no_reply and cold_lead ─────────────────────────────────────────

export async function sweepTriggers(now = new Date()): Promise<{ noReply: number; cold: number; noShows: number }> {
  const sequences = (await store().listSequences()).filter((s) => s.active && (s.trigger === "no_reply" || s.trigger === "cold_lead"));
  let noReply = 0;
  let cold = 0;
  if (sequences.length) {
    const leads = (await premium.listLeads({ limit: 200 })).filter((l) => l.status !== "won" && l.status !== "lost");
    const runs = await store().listRuns();
    const conversations = new Map((await store().listConversations()).map((c) => [c.leadId, c]));
    for (const lead of leads) {
      if (conversations.get(lead.id)?.mode === "human") continue;
      const lastActivity = lead.context.lastMessageAt ?? lead.createdAt;
      for (const seq of sequences) {
        const since = runs.some((r) => r.leadId === lead.id && r.sequenceId === seq.id && r.startedAt >= lastActivity);
        if (since) continue;
        if (seq.trigger === "cold_lead") {
          const days = seq.params.afterDays ?? 14;
          if (Date.parse(lastActivity) + days * 86_400_000 > now.getTime()) continue;
          await startRun(seq, lead.id, { source: "scheduler" }, now);
          cold += 1;
        } else {
          const hours = seq.params.afterHours ?? 48;
          if (!lead.context.lastMessageAt || Date.parse(lead.context.lastMessageAt) + hours * 3_600_000 > now.getTime()) continue;
          const detail = await premium.getLead(lead.id);
          const last = detail.messages.at(-1);
          if (!last || last.direction !== "outbound") continue; // the buyer spoke last — nothing to nudge
          if (await activeVisitFor(lead.id)) continue;
          await startRun(seq as Sequence, lead.id, { source: "scheduler" }, now);
          noReply += 1;
        }
      }
    }
  }
  const noShows = await detectNoShows(now);
  return { noReply, cold, noShows };
}

async function activeVisitFor(leadId: string): Promise<boolean> {
  return (await store().listVisits({ leadId })).some((v) => v.status === "scheduled" || v.status === "confirmed");
}

// ─── The loop ───────────────────────────────────────────────────────────────

export async function tick(now = new Date(), opts: { sweep?: boolean } = {}): Promise<void> {
  const h = holder();
  if (h.running) return;
  h.running = true;
  try {
    if (opts.sweep ?? now.getTime() - h.lastSweepAt >= SWEEP_MS) {
      h.lastSweepAt = now.getTime();
      await sweepTriggers(now);
    }
    await runDueJobs(now);
    await alertOverdueFirstReplies(now);
    h.lastTickAt = new Date().toISOString();
    h.lastError = null;
  } catch (error) {
    h.lastError = error instanceof Error ? error.message : "unknown";
    console.warn("[engine] tick failed:", h.lastError);
  } finally {
    h.running = false;
  }
}

export function startEngine(): void {
  const h = holder();
  if (h.timer) return;
  h.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

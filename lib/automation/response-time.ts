import "server-only";
import { audit, store } from "../store";
import type { FirstReply } from "../store/types";

/**
 * TIME TO FIRST REPLY — for every new lead, from its arrival in the shared
 * leads store (premium createdAt) to the first message that went out on its
 * thread, whichever path sent it (marketing first-touch, the desk's instant
 * reply, or a held draft an operator released). One row per lead; the first
 * reply is recorded once and never moved.
 *
 * The rep is alerted on the lead's timeline (and, for a lead a marketing
 * workspace handles, in that workspace's notifications — raised by the
 * harness side, lib/marketing/agents/first-touch.ts) when the first reply
 * took longer than 90 seconds, needs approval, or could not go out.
 */

export const FIRST_REPLY_TARGET_MS = 90_000;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function alertRep(row: FirstReply, reason: string, now: string): Promise<FirstReply> {
  const assignee = (await store().listAssignments(row.leadId)).at(-1)?.repId ?? null;
  await audit("first-reply-alert", row.leadId, "first-reply-monitor", `${assignee ? `Alert for ${assignee}: ` : "Alert (no rep assigned yet): "}${reason}`);
  const next = { ...row, alertedAt: now };
  await store().upsertFirstReply(next);
  return next;
}

/** Starts the lead's row (idempotent: an existing row is returned untouched). */
export async function openFirstReply(input: { leadId: string; arrivedAt: string; workspaceId?: string | null; campaignId?: string | null }): Promise<FirstReply> {
  const existing = await store().getFirstReply(input.leadId);
  if (existing) return existing;
  const row: FirstReply = { leadId: input.leadId, arrivedAt: input.arrivedAt, firstReplyAt: null, ms: null, path: null, status: "awaiting_approval", types: [], note: null, workspaceId: input.workspaceId ?? null, campaignId: input.campaignId ?? null, alertedAt: null };
  await store().upsertFirstReply(row);
  return row;
}

/** Records the FIRST message that went out (later ones change nothing). Alerts the rep when it took longer than 90 s. */
export async function recordFirstReply(input: { leadId: string; arrivedAt: string; at: string; path: NonNullable<FirstReply["path"]>; types?: string[]; workspaceId?: string | null; campaignId?: string | null }): Promise<FirstReply> {
  const row = await openFirstReply(input);
  if (row.firstReplyAt) return row;
  const ms = Math.max(0, Date.parse(input.at) - Date.parse(row.arrivedAt));
  const next: FirstReply = { ...row, firstReplyAt: input.at, ms, path: input.path, status: "replied", types: input.types ?? row.types, note: null, workspaceId: input.workspaceId ?? row.workspaceId, campaignId: input.campaignId ?? row.campaignId };
  await store().upsertFirstReply(next);
  await audit("first-reply", input.leadId, "first-reply-monitor", `first reply after ${secs(ms)} (${input.path.replace(/_/g, " ")})`);
  if (ms > FIRST_REPLY_TARGET_MS) return alertRep(next, `the first reply took ${secs(ms)} — over the 90-second target`, input.at);
  return next;
}

/** Nothing went out automatically: a draft waits for approval, or the reply is blocked. The rep is alerted now. */
export async function holdFirstReply(input: { leadId: string; arrivedAt: string; status: "awaiting_approval" | "blocked"; note: string; workspaceId?: string | null; campaignId?: string | null }, now = new Date().toISOString()): Promise<FirstReply> {
  const row = await openFirstReply(input);
  if (row.firstReplyAt) return row;
  const next: FirstReply = { ...row, status: input.status, note: input.note };
  await store().upsertFirstReply(next);
  return row.alertedAt ? next : alertRep(next, input.status === "awaiting_approval" ? `the first reply needs approval — ${input.note}` : `no first reply could go out — ${input.note}`, now);
}

/** Alerts the lead's rep now (once per lead — later calls are no-ops). True when this call alerted. */
export async function alertFirstReply(leadId: string, reason: string, now = new Date().toISOString()): Promise<boolean> {
  const row = await store().getFirstReply(leadId);
  if (!row || row.alertedAt) return false;
  await alertRep(row, reason, now);
  return true;
}

/** Leads with no first reply 90 s after arriving, not alerted yet — `workspaceId` narrows to one workspace's (null = leads no workspace handles). */
export async function overdueFirstReplies(now: Date, workspaceId: string | null): Promise<FirstReply[]> {
  return (await store().listFirstReplies()).filter((r) => !r.firstReplyAt && !r.alertedAt && r.workspaceId === workspaceId && now.getTime() - Date.parse(r.arrivedAt) > FIRST_REPLY_TARGET_MS);
}

export const overdueReason = (row: FirstReply, now: Date) => `no reply yet, ${secs(now.getTime() - Date.parse(row.arrivedAt))} after the lead arrived`;

/** Engine sweep for leads no marketing workspace handles (the harness tick alerts its own). */
export async function alertOverdueFirstReplies(now = new Date()): Promise<number> {
  const rows = await overdueFirstReplies(now, null);
  for (const row of rows) await alertRep(row, overdueReason(row, now), now.toISOString());
  return rows.length;
}

export interface ReplyStats {
  leads: number;
  replied: number;
  medianMs: number | null;
  /** Leads answered within 90 s, out of every lead whose 90 s are up (or that was answered). Null with none. */
  under90Share: number | null;
  waiting: number;
}

/** Median and share under 90 s — for all leads, or one campaign's. */
export function replyStats(rows: FirstReply[], now = Date.now()): ReplyStats {
  const ms = rows.filter((r) => r.ms !== null).map((r) => r.ms!).sort((a, b) => a - b);
  const mid = ms.length >> 1;
  const median = ms.length === 0 ? null : ms.length % 2 ? ms[mid] : Math.round((ms[mid - 1] + ms[mid]) / 2);
  const due = rows.filter((r) => r.ms !== null || now - Date.parse(r.arrivedAt) > FIRST_REPLY_TARGET_MS);
  return {
    leads: rows.length,
    replied: ms.length,
    medianMs: median,
    under90Share: due.length ? due.filter((r) => r.ms !== null && r.ms <= FIRST_REPLY_TARGET_MS).length / due.length : null,
    waiting: rows.filter((r) => !r.firstReplyAt).length,
  };
}

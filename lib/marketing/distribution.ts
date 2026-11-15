import "server-only";
import { randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import { marketing } from "../premium/marketing-client";
import type { Broadcast } from "../premium/marketing-contract";
import { deliver } from "../automation/delivery";
import { renderFor } from "../automation/vars";
import { audit, store } from "../store";
import type { Job } from "../store/types";
import { LOCAL_RULES, resolveList } from "./buyer-lists";

/**
 * DISTRIBUTION — scheduled social posts and broadcasts. Nothing here can skip
 * the gate: publishing and sending are spine transitions that refuse anything
 * not approved.
 *
 *  Social (Instagram / Facebook / LinkedIn / YouTube): STUBBED. Publishing
 *    records a publication per channel on the spine; no social API is called.
 *  Email broadcast: REAL sends to the segment's CONSENTED leads only (our own
 *    opted-in list), through lib/email.ts; each send is logged on the lead's
 *    thread and as a job on the sales timeline.
 *  WhatsApp broadcast: built and QUEUED "pending Twilio" per recipient, with
 *    its approved template name/language ready for when Twilio resumes.
 */

// ─── Social calendar: publish what is due ───────────────────────────────────

export async function publishDue(now = new Date(), actor = "marketing-scheduler"): Promise<{ published: string[]; failed: { id: string; error: string }[] }> {
  const scheduled = await marketing.listContent({ status: "scheduled", limit: 200 });
  const due = scheduled.filter((a) => a.scheduledAt && Date.parse(a.scheduledAt) <= now.getTime());
  const published: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const asset of due) {
    try {
      await marketing.transition({ objectType: "content", objectId: asset.id, to: "published", actor, note: "scheduled time reached — published (stub: no social API)" });
      published.push(asset.id);
    } catch (error) {
      failed.push({ id: asset.id, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  if (published.length) await audit("marketing-published", null, actor, `${published.length} scheduled post(s) published (stub)`);
  return { published, failed };
}

const KEY = "__marketingPublisher";
const g = globalThis as unknown as Record<string, ReturnType<typeof setInterval> | undefined>;

/** Checks the calendar every minute (instrumentation.ts). */
export function startMarketingPublisher(): void {
  if (g[KEY]) return;
  g[KEY] = setInterval(() => void publishDue().catch((e) => console.warn("[marketing-publisher]", e instanceof Error ? e.message : e)), 60_000);
}

// ─── Broadcasts ─────────────────────────────────────────────────────────────

export class BroadcastBlocked extends Error {}

/** Creates a broadcast draft; the RERA line is appended so approval checks exactly what will be sent. */
export async function draftBroadcast(input: { segmentId: string; channel: "email" | "whatsapp"; name: string; body: string; subject?: string; waTemplateName?: string; waTemplateLanguage?: string; waTemplateVariables?: string[]; campaignId?: string }, actor: string) {
  const kit = await marketing.getBrandKit();
  if (!kit?.defaultReraRegNo) throw new BroadcastBlocked("Set the RERA registration number in Brand settings first.");
  const line = `RERA Reg. No.: ${kit.defaultReraRegNo}`;
  const body = input.body.includes(line) ? input.body : `${input.body.trimEnd()}\n\n${line}`;
  const b = await marketing.createBroadcast({ ...input, body, createdBy: actor });
  await audit("marketing-broadcast-drafted", null, actor, `${b.channel} broadcast "${b.name}" (${b.id}) saved as draft`);
  return b;
}

/**
 * Sends an APPROVED broadcast to its consented audience. The spine refuses
 * to record (and so to publish) a send that isn't approved — and we check
 * first so nothing leaves before that.
 */
export async function sendBroadcast(broadcastId: string, actor: string): Promise<Broadcast> {
  const b = (await marketing.listBroadcasts({ limit: 200 })).find((x) => x.id === broadcastId);
  if (!b) throw new BroadcastBlocked("Broadcast not found.");
  if (b.status !== "approved") throw new BroadcastBlocked(`Nothing broadcasts without approval — this one is ${b.status}.`);
  const audience = await marketing.audience(broadcastId);
  if (audience.eligible.length === 0) throw new BroadcastBlocked("No consented recipients in this segment.");
  // Premium resolves consent; the list rules it doesn't apply (score, last activity, several projects) are applied here.
  const segment = (await marketing.listSegments({ limit: 200 })).find((s) => s.id === b.segmentId);
  const local = segment && LOCAL_RULES.some((k) => k in segment.rules) ? new Set((await resolveList(segment.rules)).leads.map((l) => l.id)) : null;
  const results: { leadId: string; status: "sent" | "failed" | "pending_twilio" | "skipped"; note?: string }[] = [];
  for (const leadId of audience.eligible) {
    if (local && !local.has(leadId)) {
      results.push({ leadId, status: "skipped", note: "not on the list now (score / last activity / project)" });
      continue;
    }
    const lead = await premium.getLead(leadId);
    // The approved body already carries its RERA line (added at creation, checked at approval).
    const body = await renderFor(b.body, { lead });
    const source = `broadcast:${b.id}`;
    const now = new Date().toISOString();
    const result =
      b.channel === "email"
        ? await deliver(leadId, "email", body, source, { emailLive: { subject: b.subject ?? b.name, consented: true } })
        : await deliver(leadId, "whatsapp", body, source);
    const job: Job = { id: randomUUID(), leadId, runId: null, sequenceId: null, stepIndex: null, channel: b.channel, template: b.body, body, runAt: now, status: result.status, note: b.channel === "whatsapp" ? `${result.note} · template ${b.waTemplate?.name} (${b.waTemplate?.language})` : result.note, premiumMessageId: result.premiumMessageId, createdAt: now, executedAt: now, source };
    await store().upsertJob(job);
    results.push({ leadId, status: result.status, note: (job.note ?? undefined)?.slice(0, 300) });
  }
  const done = await marketing.recordDeliveries(broadcastId, { actor, results });
  await audit("marketing-broadcast-sent", null, actor, `${b.channel} broadcast "${b.name}": ${Object.entries(done.deliveries).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  return done;
}

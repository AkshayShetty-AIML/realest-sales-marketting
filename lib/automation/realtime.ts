import "server-only";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { premiumRealtimeConfig } from "../env";
import { premium } from "../premium/client";
import { store } from "../store";
import { handleNewLead } from "./new-lead";

/**
 * THE NEW-LEAD FEED. Two paths into one idempotent sync:
 *
 *  1. REALTIME — this server subscribes to the premium project's PUBLIC
 *     broadcast topic "leads" (premium migration 20261002000500) with the
 *     premium ANON key. The event carries NO lead data — it is only a signal.
 *  2. POLLING FALLBACK — whenever Realtime isn't subscribed (not configured,
 *     connecting, dropped), GET /leads?since=<cursor> every POLL_MS.
 *
 * Either way the sync reads leads through the internal API (x-service-key,
 * contact MASKED) and hands each NEW one — created after the lead loop went
 * live, never seen before — to ./new-lead.ts: first reply, then the funnel
 * agent (MKT-17). On the very first start the cursors are set to "now", so
 * historic leads are left to the reps; a lead that was only updated is not new.
 */

const CURSOR = "premium-leads";
/** When the lead loop started: only leads created after it are new. */
const LOOP_START = "lead-loop-start";
const POLL_MS = 5000;
/** Pages per sync (200 leads each); anything beyond is picked up by the next sync. */
const MAX_PAGES = 25;

export type FeedStatus = "off" | "connecting" | "subscribed" | "polling" | "error";

interface Holder {
  status: FeedStatus;
  detail: string;
  channel: RealtimeChannel | null;
  timer: ReturnType<typeof setInterval> | null;
  lastSignalAt: string | null;
  lastSyncAt: string | null;
  syncing: Promise<number> | null;
}

const KEY = "__salesLeadFeed";
const g = globalThis as unknown as Record<string, Holder | undefined>;
const holder = (): Holder =>
  (g[KEY] ??= { status: "off", detail: "not started", channel: null, timer: null, lastSignalAt: null, lastSyncAt: null, syncing: null });

export function feedStatus() {
  const { status, detail, lastSignalAt, lastSyncAt } = holder();
  return { status, detail, lastSignalAt, lastSyncAt };
}

async function syncOnce(trigger: string): Promise<number> {
  const cursor = await store().getCursor(CURSOR);
  const now = new Date().toISOString();
  if (!cursor) {
    await store().setCursor(CURSOR, now);
    return 0;
  }
  let start = await store().getCursor(LOOP_START);
  if (!start) await store().setCursor(LOOP_START, (start = now));
  // Premium's sync cursor: pass nextCursor back as received, page while hasMore. Saved after
  // every page, so a restart resumes where it stopped. (A v1 ISO time is still a valid cursor.)
  let next = cursor;
  let handled = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await premium.syncLeads(next);
    for (const lead of r.leads) {
      if (Date.parse(lead.createdAt) < Date.parse(start) || lead.status === "won" || lead.status === "lost") continue;
      try {
        const result = await handleNewLead(lead, trigger);
        if (!result.handled) continue;
        console.info(`[lead-feed] ${lead.id}: ${result.firstReply}${result.workspaceId ? ` · funnel in ${result.workspaceId}` : ""}`);
        handled += 1;
      } catch (error) {
        console.warn(`[lead-feed] ${lead.id}: failed — ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    next = r.nextCursor;
    await store().setCursor(CURSOR, next);
    if (!r.hasMore) break;
  }
  holder().lastSyncAt = new Date().toISOString();
  return handled;
}

/** One sync at a time — a broadcast and a poll tick can't overlap. */
export function sync(trigger: string): Promise<number> {
  const h = holder();
  if (h.syncing) return h.syncing;
  h.syncing = syncOnce(trigger)
    .catch((error) => {
      console.warn("[lead-feed] sync failed:", error instanceof Error ? error.message : error);
      return 0;
    })
    .finally(() => {
      h.syncing = null;
    });
  return h.syncing;
}

export function startLeadFeed(): void {
  const h = holder();
  if (h.timer) return; // one feed per process (dev HMR / repeated register())

  // Polling runs whenever Realtime isn't live.
  h.timer = setInterval(() => {
    if (h.status !== "subscribed") void sync("poll");
  }, POLL_MS);
  h.status = "polling";
  h.detail = `polling /leads every ${POLL_MS / 1000}s`;

  const config = premiumRealtimeConfig();
  if (!config) {
    h.detail = `polling /leads every ${POLL_MS / 1000}s (PREMIUM_SUPABASE_URL / PREMIUM_SUPABASE_ANON_KEY not set, so no Realtime)`;
    return;
  }
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  h.channel = client
    .channel("leads")
    .on("broadcast", { event: "lead_created" }, () => {
      h.lastSignalAt = new Date().toISOString();
      void sync("realtime");
    })
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        h.status = "subscribed";
        h.detail = "listening on the premium \"leads\" channel";
        void sync("realtime-connect"); // catch up on anything missed while not subscribed
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        h.status = "polling";
        h.detail = `Realtime ${status.toLowerCase()}${error ? ` (${error.message})` : ""} — polling every ${POLL_MS / 1000}s until it reconnects`;
      }
    });
}

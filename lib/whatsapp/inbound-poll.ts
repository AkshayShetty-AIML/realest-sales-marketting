import "server-only";
import { twilioConfig } from "../env";
import { store } from "../store";
import { handleInbound } from "../automation/inbound";
import { toE164 } from "./phone";

/**
 * INBOUND WITHOUT A WEBHOOK. Some Twilio senders (the trial "Try out
 * WhatsApp" number) can't point incoming messages at a webhook. Every inbound
 * message is still in the account's message log, so this reads it every
 * POLL_MS and hands each new reply to the same handler the webhook uses.
 * Each Message SID is claimed once (store.claimInboundSid), so webhook +
 * poller never double-process. Read-only against Twilio — it sends nothing
 * itself. On start it looks back LOOKBACK_MS only, so old messages aren't replayed.
 */

const POLL_MS = 10_000;
const LOOKBACK_MS = 10 * 60_000;

interface TwilioMessage {
  sid: string;
  from: string;
  body: string | null;
  direction: string;
  date_sent: string | null;
  date_created: string;
}

interface Holder {
  timer: ReturnType<typeof setInterval> | null;
  since: number;
  running: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  handled: number;
}

const KEY = "__salesInboundPoll";
const g = globalThis as unknown as Record<string, Holder | undefined>;
const holder = (): Holder => (g[KEY] ??= { timer: null, since: Date.now() - LOOKBACK_MS, running: false, lastPollAt: null, lastError: null, handled: 0 });

export function inboundPollStatus() {
  const { timer, lastPollAt, lastError, handled } = holder();
  return { on: Boolean(timer), lastPollAt, lastError, handled, everySeconds: POLL_MS / 1000 };
}

async function pollOnce(): Promise<void> {
  const h = holder();
  const config = twilioConfig();
  if (!config || h.running) return;
  h.running = true;
  try {
    const query = new URLSearchParams({ To: config.from, PageSize: "50" });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json?${query}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Twilio message log ${response.status}`);
    const json = (await response.json()) as { messages?: TwilioMessage[] };
    const fresh = (json.messages ?? [])
      .filter((m) => m.direction === "inbound" && Date.parse(m.date_sent ?? m.date_created) > h.since)
      .sort((a, b) => Date.parse(a.date_sent ?? a.date_created) - Date.parse(b.date_sent ?? b.date_created));
    for (const m of fresh) {
      const from = toE164(m.from);
      const body = (m.body ?? "").trim();
      if (!from || !body) continue;
      if (!(await store().claimInboundSid(m.sid))) continue;
      try {
        const result = await handleInbound(from, body.slice(0, 4000), new Date(m.date_sent ?? m.date_created).toISOString());
        h.handled += 1;
        console.info(`[twilio] inbound ${m.sid} (log poll): ${result.outcome}${result.leadId ? ` (${result.leadId})` : ""}`);
      } catch (error) {
        console.warn(`[twilio] inbound ${m.sid} (log poll) failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    // Advance only past what we've seen; SID claims cover same-second ties.
    const newest = fresh.at(-1);
    if (newest) h.since = Math.max(h.since, Date.parse(newest.date_sent ?? newest.date_created) - 1000);
    h.lastPollAt = new Date().toISOString();
    h.lastError = null;
  } catch (error) {
    h.lastError = error instanceof Error ? error.message : "unknown";
  } finally {
    h.running = false;
  }
}

export function startInboundPoller(): void {
  const h = holder();
  if (h.timer || !twilioConfig()) return;
  h.timer = setInterval(() => void pollOnce(), POLL_MS);
  void pollOnce();
}

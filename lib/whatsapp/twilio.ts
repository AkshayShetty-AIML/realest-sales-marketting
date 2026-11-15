import "server-only";
import { randomUUID } from "node:crypto";
import { contactPepper, twilioConfig, whatsappPaused, type TwilioConfig } from "../env";
import { premium } from "../premium/client";
import { store } from "../store";
import type { WaStatus } from "../store/types";
import { maskE164, phoneHash, toE164 } from "./phone";

/**
 * REAL WhatsApp over Twilio's REST API (no SDK). The premium app only LOGS
 * messages; this module SENDS them. SERVER ONLY — credentials never leave it.
 *
 *  1. OPT-IN required (store.getOptIn) — WhatsApp Business policy.
 *  2. DESTINATION: sandbox + WHATSAPP_DEMO_TO → always that number (your own
 *     phone). Otherwise the lead's phone, fetched UNMASKED from the premium API
 *     at send time and never stored (only its peppered hash).
 *  3. 24-HOUR WINDOW: free-form text only within 24 h of the buyer's last
 *     WhatsApp message TO US — from the inbound webhook, or, when that record
 *     is missing/closed, from Twilio's own message log (source of truth). Outside it, the approved template (TWILIO_CONTENT_SID) is sent;
 *     with no template, the send is refused with a clear reason.
 *  4. Every attempt is recorded (wa_messages) with Twilio's status; the status
 *     webhook (/api/twilio/status) moves it to sent / delivered / read / failed.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

/** Plain-language versions of the Twilio errors reps actually hit. */
const FRIENDLY: Record<string, string> = {
  "63016": "Outside WhatsApp's 24-hour window — only an approved template can be sent.",
  "63015": "This number hasn't joined the Twilio sandbox yet (send the sandbox join code from that phone).",
  "63007": "TWILIO_WHATSAPP_FROM isn't a WhatsApp sender on this Twilio account.",
  "63003": "The destination isn't a WhatsApp number.",
  "21211": "The phone number isn't valid.",
  "21408": "WhatsApp messaging isn't enabled for this region on the Twilio account.",
  "21610": "The buyer has blocked messages from this number (STOP).",
  "20003": "Twilio rejected the credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
  "20404": "Twilio couldn't find that resource — check TWILIO_CONTENT_SID / the account SID.",
};

export function friendlyTwilioError(code: string | number | null | undefined, fallback: string): string {
  return (code && FRIENDLY[String(code)]) || fallback;
}

const auth = (c: TwilioConfig) => `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`;

export function windowOpen(lastInboundAt: string | null, now = Date.now()): boolean {
  return lastInboundAt !== null && now - Date.parse(lastInboundAt) < WINDOW_MS;
}

// ─── Templates (Content API) ────────────────────────────────────────────────

const templateCache = new Map<string, string>();

/** The approved template's text with {{n}} filled — what the buyer will actually read. */
export async function renderTemplate(config: TwilioConfig, vars: Record<string, string>): Promise<string | null> {
  if (!config.contentSid) return null;
  let text = templateCache.get(config.contentSid);
  if (!text) {
    const response = await fetch(`https://content.twilio.com/v1/Content/${config.contentSid}`, {
      headers: { Authorization: auth(config) },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new WhatsAppError(friendlyTwilioError(response.status === 404 ? "20404" : null, `Couldn't load the WhatsApp template (${response.status}).`));
    const json = (await response.json()) as { types?: Record<string, { body?: string }> };
    text = Object.values(json.types ?? {}).find((t) => typeof t.body === "string")?.body ?? "";
    if (!text) throw new WhatsAppError("The WhatsApp template has no text body.");
    templateCache.set(config.contentSid, text);
  }
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => vars[n] ?? "");
}

// ─── The 24-hour window, with Twilio as the source of truth ────────────────

const lastChecked = new Map<string, number>();
const RECHECK_MS = 60_000;

/**
 * When our record says the window is closed (or we've never seen this
 * number), ask Twilio's message log for the buyer's latest message TO our
 * sender — it sees everything, including messages sent before the inbound
 * webhook was configured (e.g. the sandbox join code). Throttled per number.
 */
async function lastInboundAt(config: TwilioConfig, dest: string, hash: string): Promise<string | null> {
  const local = (await store().getWaSession(hash))?.lastInboundAt ?? null;
  if (windowOpen(local)) return local;
  const last = lastChecked.get(hash) ?? 0;
  if (Date.now() - last < RECHECK_MS) return local;
  lastChecked.set(hash, Date.now());
  try {
    const query = new URLSearchParams({ From: `whatsapp:${dest}`, To: config.from, PageSize: "1" });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json?${query}`, {
      headers: { Authorization: auth(config) },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return local;
    const json = (await response.json()) as { messages?: { date_sent?: string | null; date_created?: string }[] };
    const raw = json.messages?.[0]?.date_sent ?? json.messages?.[0]?.date_created;
    const at = raw ? new Date(raw).toISOString() : null;
    if (at && (!local || at > local)) {
      await store().touchWaSession(hash, at);
      return at;
    }
    return local;
  } catch {
    return local;
  }
}

// ─── Destination + plan ─────────────────────────────────────────────────────

async function destinationFor(leadId: string, config: TwilioConfig): Promise<string> {
  if (config.mode === "sandbox" && config.demoTo) {
    const demo = toE164(config.demoTo);
    if (!demo) throw new WhatsAppError("WHATSAPP_DEMO_TO isn't a valid phone number.");
    return demo;
  }
  const lead = await premium.getLead(leadId, { includeContact: true });
  const phone = lead.contact.phone ? toE164(lead.contact.phone) : null;
  if (!phone) throw new WhatsAppError("This buyer hasn't shared a phone number.");
  return phone;
}

export interface WhatsAppPlan {
  configured: boolean;
  optedIn: boolean;
  /** Masked destination, or why there isn't one. */
  to: string | null;
  problem: string | null;
  windowOpen: boolean;
  lastInboundAt: string | null;
  /** Only meaningful when the window is closed. */
  templateAvailable: boolean;
  sandbox: boolean;
}

/** What a WhatsApp send to this lead would do right now — for the composer. */
export async function whatsappPlan(leadId: string): Promise<WhatsAppPlan> {
  const config = twilioConfig();
  const optedIn = (await store().getOptIn(leadId))?.status === "opted_in";
  const base = { configured: Boolean(config), optedIn, to: null, problem: null, windowOpen: false, lastInboundAt: null, templateAvailable: Boolean(config?.contentSid), sandbox: config?.mode === "sandbox" };
  if (!config) return { ...base, problem: whatsappPaused() ? "WhatsApp is paused on this desk (WHATSAPP_PAUSED=true)." : "Twilio isn't configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)." };
  try {
    const dest = await destinationFor(leadId, config);
    const at = await lastInboundAt(config, dest, phoneHash(dest, contactPepper()));
    return { ...base, to: maskE164(dest), windowOpen: windowOpen(at), lastInboundAt: at };
  } catch (error) {
    return { ...base, problem: error instanceof Error ? error.message : "No destination." };
  }
}

// ─── Send ───────────────────────────────────────────────────────────────────

export interface WhatsAppSent {
  waMessageId: string;
  sid: string;
  /** What the buyer received (the rendered template when one was used). */
  sentBody: string;
  template: boolean;
  to: string;
}

const STATUS_MAP: Record<string, WaStatus> = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "undelivered",
};
export const toWaStatus = (s: string | undefined): WaStatus => STATUS_MAP[s ?? ""] ?? "queued";

export async function sendWhatsApp(leadId: string, body: string, sentBy: string): Promise<WhatsAppSent> {
  const optIn = await store().getOptIn(leadId);
  if (optIn?.status !== "opted_in") throw new WhatsAppError("This buyer hasn't opted in to WhatsApp — record consent first, or reply in-app.");
  const config = twilioConfig();
  if (!config) throw new WhatsAppError(whatsappPaused() ? "WhatsApp is paused on this desk." : "WhatsApp isn't configured on this desk (Twilio credentials missing).");

  const dest = await destinationFor(leadId, config);
  const hash = phoneHash(dest, contactPepper());
  const open = windowOpen(await lastInboundAt(config, dest, hash));

  const params = new URLSearchParams({ From: config.from, To: `whatsapp:${dest}` });
  let sentBody = body;
  if (open) {
    params.set("Body", body);
  } else {
    if (!config.contentSid) {
      throw new WhatsAppError("Outside WhatsApp's 24-hour window and no approved template is configured (TWILIO_CONTENT_SID). Reply in-app, or wait for the buyer to message you.", "63016");
    }
    const lead = await premium.getLead(leadId);
    const vars = { "1": lead.contact.name?.split(/\s+/)[0] ?? "there", "2": lead.context.property?.name ?? "the property" };
    sentBody = (await renderTemplate(config, vars)) ?? body;
    params.set("ContentSid", config.contentSid);
    params.set("ContentVariables", JSON.stringify(vars));
  }
  if (config.webhookBase) params.set("StatusCallback", `${config.webhookBase}/api/twilio/status`);

  const now = new Date().toISOString();
  const record = { id: randomUUID(), leadId, premiumMessageId: null, body: sentBody, template: !open, sentBy, at: now, updatedAt: now };
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: auth(config), "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    await store().addWaMessage({ ...record, sid: null, status: "failed", errorCode: null, errorMessage: "Couldn't reach Twilio." });
    throw new WhatsAppError("Couldn't reach Twilio — check the connection and try again.");
  }
  const json = (await response.json().catch(() => ({}))) as { sid?: string; status?: string; code?: number; message?: string };
  if (!response.ok || !json.sid) {
    const message = friendlyTwilioError(json.code, `Twilio refused the message (${response.status}): ${json.message ?? "unknown error"}`);
    await store().addWaMessage({ ...record, sid: null, status: "failed", errorCode: json.code ? String(json.code) : String(response.status), errorMessage: message });
    throw new WhatsAppError(message, json.code ? String(json.code) : null);
  }
  await store().addWaMessage({ ...record, sid: json.sid, status: toWaStatus(json.status), errorCode: null, errorMessage: null });
  await store().indexContact(hash, leadId);
  return { waMessageId: record.id, sid: json.sid, sentBody, template: !open, to: maskE164(dest) };
}

export function whatsappMode(): "off" | "paused" | "sandbox" | "live" {
  if (whatsappPaused()) return "paused";
  const config = twilioConfig();
  return config ? config.mode : "off";
}

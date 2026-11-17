import "server-only";
import { randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import { audit, store } from "../store";
import type { Job, StepChannel } from "../store/types";
import { sendEmail } from "../email";
import { compliantBody, OutboundBlocked } from "../compliance";

/**
 * THE ONE PLACE AN AUTOMATED MESSAGE LEAVES THE DESK.
 *   in_app             → DELIVERED: POST /leads/:id/messages (channel in_app);
 *                        the premium app puts it in the buyer's thread.
 *   whatsapp/sms/email → QUEUED: recorded as status "pending_twilio" and shown
 *                        as "pending Twilio (production)". Nothing is sent.
 *   email, emailLive   → SENT for real (lib/email.ts) — only when the caller
 *                        opts in (marketing sequences / campaign sends), the
 *                        lead consented to email, and a provider is set; the
 *                        sent copy is logged on the premium thread. Sales
 *                        sequences never opt in, so their email stays queued.
 * Every send is a Job row, so the lead page shows exactly what went (or waits).
 * Every body leaves with its project's RERA line or exemption (and an AI label
 * where AI wrote it) — lib/compliance.ts; with neither, nothing goes out.
 */

export const PENDING_TWILIO_LABEL = "pending Twilio (production)";
export const IN_APP_MAX = 500;

export const isLiveChannel = (channel: StepChannel) => channel === "in_app";

export interface DeliveryResult {
  status: "sent" | "pending_twilio" | "failed";
  premiumMessageId: string | null;
  note: string | null;
  /** The body as it went (or waits): with its compliance line. */
  body?: string;
}

export interface DeliverOptions {
  /** Marketing only: send email for real (consent + provider permitting). */
  emailLive?: { subject: string; consented: boolean };
  /** AI wrote this message — it carries the AI label. */
  ai?: boolean;
}

export async function deliver(leadId: string, channel: StepChannel, raw: string, sentBy: string, options: DeliverOptions = {}): Promise<DeliveryResult> {
  let body: string;
  try {
    body = await compliantBody(leadId, raw, { ai: options.ai });
  } catch (error) {
    if (!(error instanceof OutboundBlocked)) throw error;
    await audit("outbound-blocked", leadId, sentBy, `${channel}: ${error.message}`);
    return { status: "failed", premiumMessageId: null, note: error.message, body: raw };
  }
  return { ...(await deliverCompliant(leadId, channel, body, sentBy, options)), body };
}

async function deliverCompliant(leadId: string, channel: StepChannel, body: string, sentBy: string, options: DeliverOptions): Promise<DeliveryResult> {
  if (channel === "email" && options.emailLive) return deliverEmail(leadId, body, sentBy, options.emailLive);
  if (!isLiveChannel(channel)) {
    await audit("queued", leadId, sentBy, `${channel} — ${PENDING_TWILIO_LABEL}: not sent`);
    return { status: "pending_twilio", premiumMessageId: null, note: `${channel} is ${PENDING_TWILIO_LABEL} — logged, not sent` };
  }
  if (body.length > IN_APP_MAX) return { status: "failed", premiumMessageId: null, note: `in-app messages are limited to ${IN_APP_MAX} characters (${body.length})` };
  const logged = await premium.appendMessage(leadId, { channel: "in_app", body, sentBy });
  return { status: "sent", premiumMessageId: logged.id, note: null };
}

async function deliverEmail(leadId: string, body: string, sentBy: string, opts: { subject: string; consented: boolean }): Promise<DeliveryResult> {
  if (!opts.consented) {
    await audit("email-skipped", leadId, sentBy, "no email consent on the lead — not sent");
    return { status: "failed", premiumMessageId: null, note: "not sent: the lead did not consent to email" };
  }
  // Contact is revealed only here, for this one send (same rule as the WhatsApp sender).
  const lead = await premium.getLead(leadId, { includeContact: true });
  const result = await sendEmail({ to: lead.contact.email, subject: opts.subject, text: body });
  if (!result.delivered) {
    await audit("email-not-sent", leadId, sentBy, result.detail ?? result.reason ?? "not sent");
    return { status: "failed", premiumMessageId: null, note: `email not sent: ${result.detail ?? result.reason}` };
  }
  const logged = await premium.appendMessage(leadId, { channel: "email", body: `${opts.subject}\n\n${body}`.slice(0, 4000), sentBy });
  await audit("email-sent", leadId, sentBy, `email "${opts.subject}" delivered`);
  return { status: "sent", premiumMessageId: logged.id, note: "email delivered" };
}

/** A one-off message sent right now (confirmations, feedback links) — recorded as a job for the timeline. */
export async function sendNow(leadId: string, channel: StepChannel, body: string, source: string): Promise<Job> {
  const now = new Date().toISOString();
  const result = await deliver(leadId, channel, body, source);
  const job: Job = {
    id: randomUUID(),
    leadId,
    runId: null,
    sequenceId: null,
    stepIndex: null,
    channel,
    template: body,
    body: result.body ?? body,
    runAt: now,
    status: result.status,
    note: result.note,
    premiumMessageId: result.premiumMessageId,
    createdAt: now,
    executedAt: now,
    source,
  };
  await store().upsertJob(job);
  return job;
}

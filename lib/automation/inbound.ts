import "server-only";
import { contactPepper } from "../env";
import { premium } from "../premium/client";
import { audit, store } from "../store";
import { phoneHash } from "../whatsapp/phone";
import { draftForRep, sendMessage, AI_SENDER } from "./leads";

/**
 * An INBOUND WhatsApp message — from the Twilio webhook (signature already
 * verified) or the message-log poller (lib/whatsapp/inbound-poll.ts); each
 * Message SID is claimed once before it reaches here.
 *
 *  - Always opens the 24-hour window for that number (wa_sessions, by hash).
 *  - Routes to a lead by the number's hash (indexed when we last messaged it).
 *    Unknown number → audited, nothing else.
 *  - The message is ATTACHED TO THE PREMIUM LEAD THREAD
 *    (POST /leads/:id/messages, direction "inbound").
 *  - "STOP" / "UNSUBSCRIBE" → opted out. Any other message implies opt-in.
 *  - AI mode: if the grounded draft answers everything asked, it's sent;
 *    otherwise the draft is SAVED for the rep (shown in the composer).
 *    Human mode: the draft is saved for the rep; nothing is sent.
 */

const STOP = /^\s*(stop|unsubscribe|opt ?out)\s*$/i;

export type InboundOutcome = "unmatched" | "opted out" | "answered" | "draft saved for rep";

export async function handleInbound(fromE164: string, body: string, receivedAt?: string): Promise<{ leadId: string | null; outcome: InboundOutcome }> {
  const now = receivedAt ?? new Date().toISOString();
  const hash = phoneHash(fromE164, contactPepper());
  await store().touchWaSession(hash, now);
  const leadId = await store().leadForContact(hash);
  if (!leadId) {
    await audit("inbound-unmatched", null, "twilio", "WhatsApp from a number with no lead (window opened for it)");
    return { leadId: null, outcome: "unmatched" };
  }

  await premium.appendMessage(leadId, { channel: "whatsapp", direction: "inbound", body, sentBy: "buyer" });
  await audit("inbound", leadId, "buyer", "WhatsApp reply attached to the premium thread");

  if (STOP.test(body)) {
    await store().setOptIn({ leadId, channel: "whatsapp", status: "opted_out", source: "inbound-message", recordedAt: now, simulated: false });
    await audit("opt-out", leadId, "buyer", "replied STOP on WhatsApp");
    return { leadId, outcome: "opted out" };
  }
  if ((await store().getOptIn(leadId))?.status !== "opted_in") {
    await store().setOptIn({ leadId, channel: "whatsapp", status: "opted_in", source: "inbound-message", recordedAt: now, simulated: false });
  }

  const conversation = await store().getConversation(leadId);
  const mode = conversation?.mode ?? "ai";
  const draft = await draftForRep(leadId);
  if (mode === "ai" && !draft.handoff && draft.humanTopics.length === 0) {
    await sendMessage(leadId, "whatsapp", draft.body, AI_SENDER);
    await store().setConversation({ leadId, mode, takenOverBy: null, takenOverAt: null, suggestedDraft: null });
    await audit("auto-reply", leadId, AI_SENDER, `answered on WhatsApp; ${draft.engine}; facts: ${draft.factKeys.join(", ")}`);
    return { leadId, outcome: "answered" };
  }
  await store().setConversation({
    leadId,
    mode,
    takenOverBy: conversation?.takenOverBy ?? null,
    takenOverAt: conversation?.takenOverAt ?? null,
    suggestedDraft: { body: draft.body, factKeys: draft.factKeys, humanTopics: draft.humanTopics, at: now },
  });
  await audit("needs-rep", leadId, AI_SENDER, draft.humanTopics.length ? `AI draft saved; needs a rep for: ${draft.humanTopics.join(", ")}` : "AI draft saved for the rep");
  return { leadId, outcome: "draft saved for rep" };
}

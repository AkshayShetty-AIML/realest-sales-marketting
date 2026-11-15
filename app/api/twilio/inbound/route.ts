import { verifyTwilioRequest, TWIML_EMPTY } from "@/lib/whatsapp/webhook";
import { toE164 } from "@/lib/whatsapp/phone";
import { handleInbound } from "@/lib/automation/inbound";
import { store } from "@/lib/store";

/**
 * POST /api/twilio/inbound — Twilio's "A message comes in" webhook for the
 * WhatsApp sender. Signature-verified; the sender's number is used only to
 * derive its hash and is never stored or logged. Replies go out through the
 * REST API, so the TwiML is empty.
 */
export const runtime = "nodejs";

const twiml = () => new Response(TWIML_EMPTY, { status: 200, headers: { "content-type": "text/xml" } });

export async function POST(request: Request): Promise<Response> {
  const verified = await verifyTwilioRequest(request, "/api/twilio/inbound");
  if (!verified.ok) return verified.response;
  const from = toE164(verified.params.From ?? "");
  const body = (verified.params.Body ?? "").trim().slice(0, 4000);
  if (!from || !body) return twiml();
  // Claimed once: the message-log poller may see the same message.
  const sid = verified.params.MessageSid;
  if (sid && !(await store().claimInboundSid(sid))) return twiml();
  try {
    const result = await handleInbound(from, body);
    console.info(`[twilio] inbound ${verified.params.MessageSid ?? ""}: ${result.outcome}${result.leadId ? ` (${result.leadId})` : ""}`);
  } catch (error) {
    // Twilio retries on 5xx; a premium outage shouldn't make it hammer us — log and 200.
    console.warn("[twilio] inbound handling failed:", error instanceof Error ? error.message : "unknown");
  }
  return twiml();
}

import { verifyTwilioRequest } from "@/lib/whatsapp/webhook";
import { friendlyTwilioError, toWaStatus } from "@/lib/whatsapp/twilio";
import { audit, store } from "@/lib/store";
import type { WaStatus } from "@/lib/store/types";

/**
 * POST /api/twilio/status — delivery-status callbacks for every message we
 * send (StatusCallback). Signature-verified. Moves the thread's status chip
 * forward (queued → sent → delivered → read) and records failures with a
 * plain-language reason. Never moves a status backwards.
 */
export const runtime = "nodejs";

const RANK: Record<WaStatus, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5, undelivered: 5 };

export async function POST(request: Request): Promise<Response> {
  const verified = await verifyTwilioRequest(request, "/api/twilio/status");
  if (!verified.ok) return verified.response;
  const { MessageSid: sid, MessageStatus: raw, ErrorCode: code, ErrorMessage: message } = verified.params;
  if (!sid) return new Response(null, { status: 204 });
  const record = await store().findWaMessageBySid(sid);
  if (!record) return new Response(null, { status: 204 });
  const status = toWaStatus(raw);
  if (RANK[status] < RANK[record.status]) return new Response(null, { status: 204 });
  const failed = status === "failed" || status === "undelivered";
  await store().updateWaMessage(record.id, {
    status,
    ...(failed ? { errorCode: code ?? null, errorMessage: friendlyTwilioError(code, message || `Twilio reported the message ${status}.`) } : {}),
  });
  if (failed) await audit("whatsapp-failed", record.leadId, "twilio", `${sid} ${status}${code ? ` (${code})` : ""}`);
  return new Response(null, { status: 204 });
}

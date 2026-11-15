import "server-only";
import { twilioConfig, type TwilioConfig } from "../env";
import { isValidTwilioSignature } from "./signature";

/**
 * Shared front door for Twilio webhooks: Twilio config must exist, the
 * request must be a form post, and X-Twilio-Signature must match
 * TWILIO_WEBHOOK_BASE_URL + the route path (+ query) over the form params.
 * Anything else is rejected before a single param is used.
 */
export type Verified = { ok: true; config: TwilioConfig; params: Record<string, string> } | { ok: false; response: Response };

export async function verifyTwilioRequest(request: Request, path: string): Promise<Verified> {
  const config = twilioConfig();
  if (!config?.webhookBase) return { ok: false, response: new Response("Twilio webhooks are not configured", { status: 404 }) };
  const form = await request.formData().catch(() => null);
  if (!form) return { ok: false, response: new Response("expected a form post", { status: 400 }) };
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
  const query = new URL(request.url).search;
  const url = `${config.webhookBase}${path}${query}`;
  if (!isValidTwilioSignature(config.authToken, url, params, request.headers.get("x-twilio-signature"))) {
    console.warn(`[twilio] rejected ${path}: invalid signature`);
    return { ok: false, response: new Response("invalid signature", { status: 403 }) };
  }
  return { ok: true, config, params };
}

export const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

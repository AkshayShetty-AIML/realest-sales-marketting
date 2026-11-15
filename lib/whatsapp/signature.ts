import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio webhook signature (X-Twilio-Signature): base64(HMAC-SHA1(authToken,
 * fullUrl + each POST param name+value, sorted by name)). Verified on every
 * inbound WhatsApp before anything is read from it. Pure.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function isValidTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

import { createHmac } from "node:crypto";

/**
 * Phone handling without keeping phone numbers. Pure (the pepper is passed in).
 */

/** "+91 98765 43210" / "whatsapp:+919876543210" → "+919876543210"; 10-digit Indian numbers get +91. */
export function toE164(raw: string): string | null {
  const stripped = raw.replace(/^whatsapp:/i, "").trim();
  const digits = stripped.replace(/\D/g, "");
  if (stripped.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return null;
}

/** Peppered HMAC of the E.164 number — the only form a phone is stored in (contact_index). */
export function phoneHash(e164: string, pepper: string): string {
  return createHmac("sha256", pepper).update(e164).digest("hex");
}

/** "+919876543210" → "+91 •••••••210" for logs and the UI. */
export function maskE164(e164: string): string {
  return `${e164.slice(0, 3)} •••••••${e164.slice(-3)}`;
}

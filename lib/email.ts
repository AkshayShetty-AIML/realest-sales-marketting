import "server-only";
import { emailConfig } from "./env";

/**
 * THE ONE PLACE AN EMAIL LEAVES THE DESK. POSTs { to, subject, text } to the
 * configured webhook (lib/env.ts emailConfig). Unconfigured → not sent, and
 * the caller records why. Never logs the address or the body.
 */
export interface EmailResult {
  delivered: boolean;
  reason?: "not-configured" | "provider-error" | "no-address";
  detail?: string;
}

export const emailConfigured = () => emailConfig() !== null;

export async function sendEmail(message: { to: string | null; subject: string; text: string }): Promise<EmailResult> {
  const config = emailConfig();
  if (!config) return { delivered: false, reason: "not-configured", detail: "email is off (EMAIL_WEBHOOK_URL not set)" };
  if (!message.to) return { delivered: false, reason: "no-address", detail: "the lead has no email address" };
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
      body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { delivered: true } : { delivered: false, reason: "provider-error", detail: `provider answered ${response.status}` };
  } catch (error) {
    return { delivered: false, reason: "provider-error", detail: error instanceof Error ? error.name : "unknown" };
  }
}

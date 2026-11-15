import "server-only";

/**
 * THE ONLY MODULE THAT READS SECRETS. Server-only (`import "server-only"`
 * makes a client import a build error; ESLint forbids reading these env vars
 * anywhere else). The Status page says which integrations are configured —
 * nothing is simulated: an unconfigured integration is OFF, and says so.
 */

const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export interface PremiumConfig {
  /** The internal API base, e.g. http://localhost:3000/api/internal. */
  apiBase: string;
  /** Sent as x-service-key. */
  serviceKey: string;
}

/** The premium app's internal API. Null until both values are set. */
export function premiumConfig(): PremiumConfig | null {
  // PREMIUM_API_BASE is the full base; the older PREMIUM_API_BASE_URL (origin only) still works.
  const base = read("PREMIUM_API_BASE") ?? (read("PREMIUM_API_BASE_URL") ? `${read("PREMIUM_API_BASE_URL")!.replace(/\/+$/, "")}/api/internal` : undefined);
  const serviceKey = read("SALES_INTERNAL_API_KEY");
  return base && serviceKey ? { apiBase: base.replace(/\/+$/, ""), serviceKey } : null;
}

/**
 * The premium project's Supabase URL + ANON key — used only to listen on the
 * contentless "leads" broadcast (premium migration 20261002000500). The anon
 * key can read no premium data; leads are fetched through the internal API.
 */
export function premiumRealtimeConfig(): { url: string; anonKey: string } | null {
  const url = read("PREMIUM_SUPABASE_URL")?.replace(/\/+$/, "");
  const anonKey = read("PREMIUM_SUPABASE_ANON_KEY");
  return url && anonKey ? { url, anonKey } : null;
}

/** This app's OWN Supabase (sales state). Null → the local file store. */
export function salesSupabaseConfig(): { url: string; secretKey: string } | null {
  const url = read("SALES_SUPABASE_URL")?.replace(/\/+$/, "");
  const secretKey = read("SALES_SUPABASE_SECRET_KEY");
  return url && secretKey ? { url, secretKey } : null;
}

/**
 * EMAIL (marketing nurture + campaign sends). Same seam as the premium app's
 * lib/email.ts: each email is POSTed as JSON { to, subject, text } to
 * EMAIL_WEBHOOK_URL (your provider or a relay), with EMAIL_WEBHOOK_TOKEN as a
 * bearer when set. Null → email is OFF and says so; nothing is simulated.
 */
export function emailConfig(): { url: string; token: string | null } | null {
  const url = read("EMAIL_WEBHOOK_URL");
  return url ? { url, token: read("EMAIL_WEBHOOK_TOKEN") ?? null } : null;
}

export function llmConfig(): { apiKey: string; model: string; baseUrl: string } | null {
  const apiKey = read("GROQ_API_KEY");
  if (!apiKey) return null;
  return {
    apiKey,
    model: read("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
    baseUrl: read("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1",
  };
}

/** One OpenAI-compatible model provider in the routing chain (lib/llm.ts). */
export interface LlmProviderConfig {
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/**
 * MODEL PROVIDERS, in fallback order. "groq" (GROQ_*) and an optional second
 * OpenAI-compatible provider (LLM_FALLBACK_* — OpenAI, Together, a local
 * vLLM/Ollama gateway…). LLM_PROVIDER_ORDER (e.g. "fallback,groq") reorders
 * the default chain; LLM_ROUTE_<ROUTE> (e.g. LLM_ROUTE_PLANNER=fallback,groq)
 * gives one route its own chain. Unconfigured providers are skipped.
 */
export function llmProviders(route?: string): LlmProviderConfig[] {
  const all: LlmProviderConfig[] = [];
  const groq = llmConfig();
  if (groq) all.push({ name: "groq", ...groq });
  const fallbackKey = read("LLM_FALLBACK_API_KEY");
  const fallbackBase = read("LLM_FALLBACK_BASE_URL");
  const fallbackModel = read("LLM_FALLBACK_MODEL");
  if (fallbackKey && fallbackBase && fallbackModel) all.push({ name: read("LLM_FALLBACK_NAME") ?? "fallback", apiKey: fallbackKey, baseUrl: fallbackBase.replace(/\/+$/, ""), model: fallbackModel });
  const routeOrder = route ? read(`LLM_ROUTE_${route.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`) : undefined;
  const order = (routeOrder ?? read("LLM_PROVIDER_ORDER"))?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!order) return all;
  const ordered = order.map((name) => all.find((p) => p.name === name)).filter((p): p is LlmProviderConfig => Boolean(p));
  // A route names a preference, not a whitelist: configured providers it left out still back it up.
  return [...ordered, ...all.filter((p) => !ordered.includes(p))];
}

export type TwilioMode = "sandbox" | "live";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** "whatsapp:+14155238886" for the Twilio sandbox. */
  from: string;
  mode: TwilioMode;
  /**
   * SANDBOX: when set, every outbound WhatsApp goes to this one number (your
   * own phone, joined to the sandbox) instead of the lead's — demo and test
   * leads must never message a stranger.
   */
  demoTo: string | null;
  /** Approved WhatsApp template (Content SID "HX…") for messages outside the 24-hour window. */
  contentSid: string | null;
  /** Public base URL that reaches this app (ngrok etc.). Webhook URLs and signatures derive from it. */
  webhookBase: string | null;
}

/** WHATSAPP_PAUSED=true: credentials stay in env, but nothing calls Twilio (no sends, no log polling). */
export function whatsappPaused(): boolean {
  return read("WHATSAPP_PAUSED") === "true";
}

export function twilioConfig(): TwilioConfig | null {
  if (whatsappPaused()) return null;
  const accountSid = read("TWILIO_ACCOUNT_SID");
  const authToken = read("TWILIO_AUTH_TOKEN");
  const from = read("TWILIO_WHATSAPP_FROM");
  if (!accountSid || !authToken || !from) return null;
  return {
    accountSid,
    authToken,
    from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    mode: read("TWILIO_MODE") === "live" ? "live" : "sandbox",
    demoTo: read("WHATSAPP_DEMO_TO") ?? null,
    contentSid: read("TWILIO_CONTENT_SID") ?? null,
    webhookBase: read("TWILIO_WEBHOOK_BASE_URL")?.replace(/\/+$/, "") ?? null,
  };
}

/**
 * Where BUYERS open their links (booking, visit, feedback): the /b/* pages of
 * this app. Localhost for development; in production, the public URL that
 * routes /b/* (and only /b/* and /api/twilio/*) to this app.
 */
export function publicBaseUrl(): string {
  return (read("SALES_PUBLIC_BASE_URL") ?? "http://localhost:3001").replace(/\/+$/, "");
}

/** Pepper for hashing buyer phone numbers (inbound routing without storing raw phones). */
export function contactPepper(): string {
  return read("CONTACT_HASH_PEPPER") ?? "dev-only-pepper-change-me";
}

export function authConfigured(): boolean {
  return Boolean(read("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") && read("CLERK_SECRET_KEY"));
}

/**
 * Running with NO rep auth is allowed only when explicitly asked for, and
 * proxy.ts serves it to localhost ONLY (a tunnel reaches just the Twilio webhooks).
 */
export function unauthenticatedDemoAllowed(): boolean {
  return !authConfigured() && read("SALES_ALLOW_UNAUTHENTICATED_DEMO") === "true";
}

/** MARKETING_HARNESS_STUBS=true registers the harness's test stubs (lib/marketing/harness/stubs.ts). Never in production. */
export function harnessStubsEnabled(): boolean {
  return read("MARKETING_HARNESS_STUBS") === "true";
}

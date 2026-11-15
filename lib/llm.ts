import "server-only";
import OpenAI from "openai";
import type { z } from "zod";
import { llmProviders, type LlmProviderConfig } from "./env";

/**
 * THE ONE LLM SEAM. Every model call in this app goes through here. SERVER ONLY.
 *
 * MODEL-INDEPENDENT: providers are any OpenAI-compatible API, configured in
 * lib/env.ts → llmProviders() — Groq (GROQ_*) plus an optional fallback
 * (LLM_FALLBACK_*). ROUTING: a call's `route` (e.g. "harness-planner") picks
 * its own provider order (LLM_ROUTE_<ROUTE>); otherwise the default chain.
 * FALLBACK: an error, timeout or unusable answer from one provider moves on
 * to the next; only when every provider fails does the call fail.
 *
 * It NEVER throws: a missing key, a 429, a timeout, a network/API error or an
 * unparseable answer comes back as `{ ok: false, reason }` (and is logged as a
 * warning), so every caller keeps its deterministic composer as the fallback.
 * One retry per provider (SDK: 408/409/429/5xx/connection errors) and a per-call timeout.
 *
 * The seam only transports. Grounding stays with the callers: each passes its
 * fact sheet as `context` and runs its own guard on what comes back.
 */

export interface CompleteInput {
  /** Short feature label for logs, e.g. "grounded-reply". */
  feature: string;
  system: string;
  /** The user turn. Objects are sent as JSON. */
  prompt: string | Record<string, unknown>;
  /** Grounding data merged into the user turn as its own keys (e.g. { FACTS }). */
  context?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Routing key: LLM_ROUTE_<ROUTE> may give this route its own provider order. */
  route?: string;
}

export type LlmFailureKind = "unconfigured" | "bad_output" | "error";

export type LlmResult<T> =
  | { ok: true; data: T; model: string; provider?: string }
  | { ok: false; kind: LlmFailureKind; reason: string };

/** The fallback reasons callers surface (kept identical to the pre-seam wording). */
export const NO_LLM = "no LLM configured";
const BAD_OUTPUT = "model output was not the expected JSON";

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Reasoning models (gpt-oss, qwen3, deepseek-r1) spend part of max_tokens
 * thinking before they answer; callers size maxTokens for the ANSWER, so
 * these get headroom on top.
 */
const REASONING_MODEL = /gpt-oss|qwen3|deepseek-r1/i;
const REASONING_HEADROOM = 1024;

const clients = new Map<string, OpenAI>();
function client(provider: LlmProviderConfig): OpenAI {
  const key = `${provider.baseUrl}\n${provider.apiKey}`;
  let c = clients.get(key);
  if (!c) {
    c = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl, maxRetries: 1 });
    clients.set(key, c);
  }
  return c;
}

let warnedUnconfigured = false;
function fail<T>(feature: string, kind: LlmFailureKind, reason: string): LlmResult<T> {
  if (kind !== "unconfigured" || !warnedUnconfigured) console.warn(`[llm] ${feature}: using the deterministic fallback — ${reason}`);
  if (kind === "unconfigured") warnedUnconfigured = true;
  return { ok: false, kind, reason };
}

/** True when at least one provider is configured. */
export const llmAvailable = (): boolean => llmProviders().length > 0;

/** The first provider's model name (for labels / status), or null. */
export const llmModel = (route?: string): string | null => llmProviders(route)[0]?.model ?? null;

/** The provider chain a route resolves to — names and models only (no keys), for status pages and traces. */
export const llmRoute = (route?: string): { provider: string; model: string }[] => llmProviders(route).map((p) => ({ provider: p.name, model: p.model }));

type Attempt<T> = { ok: true; data: T } | { ok: false; kind: "bad_output" | "error"; reason: string };

async function attempt(provider: LlmProviderConfig, input: CompleteInput, json: boolean): Promise<Attempt<string>> {
  const user =
    typeof input.prompt === "string"
      ? input.context ? `${JSON.stringify(input.context)}\n\n${input.prompt}` : input.prompt
      : JSON.stringify({ ...input.context, ...input.prompt });
  try {
    const completion = await client(provider).chat.completions.create(
      {
        model: provider.model,
        temperature: input.temperature ?? 0.2,
        max_tokens: (input.maxTokens ?? 600) + (REASONING_MODEL.test(provider.model) ? REASONING_HEADROOM : 0),
        ...(json ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: user },
        ],
      },
      { timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text.trim()) return { ok: false, kind: "bad_output", reason: "model returned no text" };
    return { ok: true, data: text };
  } catch (error) {
    // e.g. "model error: RateLimitError 429", "model error: APIConnectionTimeoutError".
    const status = error instanceof OpenAI.APIError && error.status ? ` ${error.status}` : "";
    const name = error instanceof Error ? (error.constructor.name !== "Error" ? error.constructor.name : error.name) : "unknown";
    return { ok: false, kind: "error", reason: `model error: ${name}${status}` };
  }
}

/** Runs the route's provider chain; `accept` turns raw text into the result (or rejects it as bad output → next provider). */
async function routed<T>(input: CompleteInput, json: boolean, accept: (text: string) => T | null): Promise<LlmResult<T>> {
  const chain = llmProviders(input.route);
  if (chain.length === 0) return fail(input.feature, "unconfigured", NO_LLM);
  let last: { kind: "bad_output" | "error"; reason: string } = { kind: "error", reason: "model error: unknown" };
  for (const [index, provider] of chain.entries()) {
    const raw = await attempt(provider, input, json);
    if (raw.ok) {
      const value = accept(raw.data);
      if (value !== null) {
        if (index > 0) console.warn(`[llm] ${input.feature}: answered by fallback provider "${provider.name}"`);
        return { ok: true, data: value, model: provider.model, provider: provider.name };
      }
      last = { kind: "bad_output", reason: BAD_OUTPUT };
    } else last = raw;
    if (index < chain.length - 1) console.warn(`[llm] ${input.feature}: provider "${provider.name}" failed (${last.reason}) — trying "${chain[index + 1].name}"`);
  }
  return fail(input.feature, last.kind, chain.length > 1 ? `${last.reason} (all ${chain.length} providers failed)` : last.reason);
}

/** Plain-text completion. */
export function complete(input: CompleteInput): Promise<LlmResult<string>> {
  return routed(input, false, (text) => text);
}

/** JSON-mode completion, validated against `schema`. Invalid JSON / shape → the next provider, then `{ ok: false, kind: "bad_output" }`. */
export function completeJson<S extends z.ZodType>(input: CompleteInput & { schema: S }): Promise<LlmResult<z.infer<S>>> {
  return routed(input, true, (text) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = input.schema.safeParse(value);
    return parsed.success ? (parsed.data as z.infer<S>) : null;
  });
}

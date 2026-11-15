/**
 * THE LLM SEAM — npm run verify:llm
 *  (a) the Groq key is read server-side only (static scan; the built client
 *      bundle too, when .next/static exists — key value never printed)
 *  (b) one live Groq call through lib/llm.ts, plus a grounded reply through it
 *  (c) missing key / bad key / timeout → the deterministic fallback, no throw
 *  (d) provider ROUTING + FALLBACK (lib/env.ts llmProviders): a failing or
 *      bad-output provider falls through to the next; per-route order; all
 *      failing → { ok: false }. Uses a local fake OpenAI-compatible server.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { complete, completeJson, llmRoute, NO_LLM } from "../lib/llm";
import { buildFacts } from "../lib/grounding/facts";
import { composeReply } from "../lib/grounding/compose";
import { draftGroundedReply } from "../lib/grounding/llm";
import { buildMarketingFacts } from "../lib/marketing/facts";
import { writeLandingHeroLine } from "../lib/marketing/generate";
import type { Property } from "../lib/premium/contract";
import { z } from "zod";

let failures = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? (n === "node_modules" || n.startsWith(".") ? [] : walk(join(dir, n))) : [join(dir, n)])) : [];
const source = ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d))).concat(["proxy.ts", "instrumentation.ts", "next.config.ts"].map((f) => join(ROOT, f)).filter(existsSync)).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
const rel = (f: string) => relative(ROOT, f);
const text = (f: string) => readFileSync(f, "utf8");

const property: Property = {
  id: "cedar-heights", name: "Cedar Heights", builder: "Trishul Infra", locality: "Hebbal", city: "Bengaluru",
  propertyType: "apartment", availableFor: ["buy"], salePrice: 11500000, rentPerMonth: null, priceLabel: "₹1.15 Cr",
  pricePerSqftLabel: "₹8,214/sqft", config: "2 BHK", areaSqft: 1400, possession: "under-construction", grade: "C+",
  verified: true, trust: { rera: "delayed", litigation: "some" }, gatedCommunity: true, nearMetro: false, constructionPct: 70,
  amenities: [{ kind: "gym", condition: "good" }, { kind: "swimming-pool", condition: "planned" }],
  inventory: { total: 1, available: 1, blocked: 0, sold: 0, lastVerifiedAt: "2026-09-24T00:00:00.000Z" },
  coords: { lat: 13.0358, lng: 77.597 },
};
const facts = buildFacts(property);
const inquiry = { kind: "price", message: "What's the price and is there a gym? Also what's the maintenance? (verify)", contactName: "Asha D." };

async function main() {
  // ── (a) ────────────────────────────────────────────────────────────────
  console.log("(a) The key is read server-side only");
  const readers = source.filter((f) => /["'`]GROQ_(API_KEY|MODEL|BASE_URL)["'`]|process\.env\.GROQ_/.test(text(f))).map(rel);
  check("GROQ_* is read in exactly one module: lib/env.ts", readers.length === 1 && readers[0] === "lib/env.ts", readers);
  check("lib/env.ts and lib/llm.ts are `server-only`", ["lib/env.ts", "lib/llm.ts"].every((f) => /^import "server-only";/m.test(text(join(ROOT, f)))));
  const fallbackReaders = source.filter((f) => /["'`]LLM_(FALLBACK_\w+|PROVIDER_ORDER|ROUTE_)|process\.env\.LLM_/.test(text(f))).map(rel);
  check("LLM_FALLBACK_* / routing env is read only in lib/env.ts", fallbackReaders.every((f) => f === "lib/env.ts"), fallbackReaders);
  const sdk = source.filter((f) => /from "openai"/.test(text(f))).map(rel);
  check("the model SDK is imported only by the seam (lib/llm.ts)", sdk.length === 1 && sdk[0] === "lib/llm.ts", sdk);
  const envFiles = [".env.example", ".env.local", ".env"].map((f) => join(ROOT, f)).filter(existsSync);
  const publicGroq = [...source, ...envFiles].filter((f) => /(NEXT_PUBLIC|EXPO_PUBLIC)_GROQ/.test(text(f))).map(rel);
  check("no NEXT_PUBLIC_/EXPO_PUBLIC_ GROQ variable anywhere", publicGroq.length === 0, publicGroq);
  const SERVER = /from "(@\/lib\/(llm|env|grounding\/llm|brochure\/generate|marketing\/(generate|capture|studio))|\.\.?\/.*(llm|env))"/;
  const clientImports = source.filter((f) => /^["']use client["']/m.test(text(f)) && SERVER.test(text(f))).map(rel);
  check("no client component imports the seam, env or an LLM caller", clientImports.length === 0, clientImports);
  const callers = source.filter((f) => /from "(\.\.?\/)+llm"|from "@\/lib\/llm"/.test(text(f))).map(rel);
  check("every caller of the seam is server-only", callers.every((f) => /^import "server-only";/m.test(text(join(ROOT, f)))), callers);
  console.log(`    callers: ${callers.join(", ")}`);
  const STATIC = join(ROOT, ".next", "static");
  if (existsSync(STATIC)) {
    const key = process.env.GROQ_API_KEY?.trim() ?? "";
    const leaks = walk(STATIC).filter((f) => /\.(js|mjs|css|html|json|txt)$/.test(f)).filter((f) => {
      const t = text(f);
      return t.includes("GROQ_API_KEY") || (key.length >= 8 && t.includes(key));
    });
    check("built client bundle (.next/static) holds neither the key value nor its name", leaks.length === 0, leaks.map(rel));
  } else console.log("  · .next/static not built — bundle scan skipped (npm run build && npm run verify:bundle)");

  // ── (b) ────────────────────────────────────────────────────────────────
  console.log("\n(b) One live Groq call through the seam");
  if (!process.env.GROQ_API_KEY?.trim()) {
    check("GROQ_API_KEY is set (add it to .env.local)", false);
  } else {
    const ping = await complete({ feature: "verify-llm", system: "You are a health check. Reply with exactly the word OK and nothing else.", prompt: "ping", temperature: 0, maxTokens: 20, timeoutMs: 20_000 });
    check(`complete() → ${ping.ok ? `"${ping.data.trim()}" from ${ping.model}` : ping.reason}`, ping.ok && /\bOK\b/i.test(ping.data));
    if (ping.ok) console.log("    OK");
    const json = await completeJson({ feature: "verify-llm", system: 'Respond as JSON: {"status": "ok"}.', prompt: "health check", schema: z.object({ status: z.string() }), temperature: 0, maxTokens: 20, timeoutMs: 20_000 });
    check(`completeJson() → ${json.ok ? JSON.stringify(json.data) : json.reason}`, json.ok);
    const draft = await draftGroundedReply(inquiry, facts);
    check(`grounded reply through the seam → engine "${draft.engine}"${draft.fallbackReason ? ` (${draft.fallbackReason})` : ""}`, draft.body.length > 0);
    check("…maintenance (not in the facts) still goes to a human", draft.humanTopics.includes("maintenance"), draft.humanTopics);
    console.log(`    "${draft.body}"`);
    const mfacts = buildMarketingFacts(property, { defaultReraRegNo: "PRM/KA/RERA/1251/309/PR/171014/000123" } as never);
    const hero = await writeLandingHeroLine(mfacts, null, "Hebbal, Bengaluru · by Trishul Infra");
    check(`landing strapline through the seam → engine "${hero.engine}"${hero.fallbackReason ? ` (${hero.fallbackReason})` : ""}`, !!hero.subhead);
    console.log(`    "${hero.subhead}"`);
  }

  // ── (c) ────────────────────────────────────────────────────────────────
  console.log("\n(c) Fallback: missing key, bad key, timeout");
  const saved = { key: process.env.GROQ_API_KEY };
  try {
    delete process.env.GROQ_API_KEY;
    const r = await complete({ feature: "verify-llm", system: "x", prompt: "y" });
    check("missing key: complete() resolves { ok: false, unconfigured } (no throw)", !r.ok && r.kind === "unconfigured" && r.reason === NO_LLM, r);
    const d = await draftGroundedReply(inquiry, facts);
    const t = composeReply(inquiry, facts);
    check(`missing key: grounded reply falls back to the deterministic composer ("${d.fallbackReason}")`, d.engine === "template" && d.fallbackReason === NO_LLM && d.body === t.body, d);

    process.env.GROQ_API_KEY = "gsk_invalid_key_for_verify";
    const bad = await draftGroundedReply(inquiry, facts);
    check(`bad key (401): falls back, no throw ("${bad.fallbackReason}")`, bad.engine === "template" && /^model error/.test(bad.fallbackReason ?? ""), bad.fallbackReason);

    if (saved.key) process.env.GROQ_API_KEY = saved.key;
    const slow = await complete({ feature: "verify-llm", system: "Write a long essay.", prompt: "go", timeoutMs: 1 });
    check(`timeout: resolves { ok: false } after one retry ("${slow.ok ? "" : slow.reason}")`, !slow.ok && slow.kind === "error", slow);
  } catch (error) {
    check("no fallback path throws", false, error instanceof Error ? error.message : error);
  } finally {
    if (saved.key) process.env.GROQ_API_KEY = saved.key;
    else delete process.env.GROQ_API_KEY;
  }

  // ── (d) ────────────────────────────────────────────────────────────────
  console.log("\n(d) Provider routing + fallback (local fake OpenAI-compatible server)");
  const hits: string[] = [];
  const fake = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { model?: string; response_format?: unknown };
      hits.push(body.model ?? "?");
      if (body.model === "always-500") {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "boom" } }));
        return;
      }
      const content = body.model === "bad-json" ? "this is not json" : body.response_format ? '{"status":"ok"}' : "OK";
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const local = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  const KEYS = ["GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODEL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_FALLBACK_NAME", "LLM_PROVIDER_ORDER", "LLM_ROUTE_VERIFY"] as const;
  const env = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const set = (vars: Partial<Record<(typeof KEYS)[number], string>>) => {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, vars);
  };
  try {
    set({ GROQ_API_KEY: "local", GROQ_BASE_URL: local, GROQ_MODEL: "always-500", LLM_FALLBACK_API_KEY: "local", LLM_FALLBACK_BASE_URL: local, LLM_FALLBACK_MODEL: "local-fallback" });
    const viaFallback = await complete({ feature: "verify-llm", system: "x", prompt: "y", timeoutMs: 5_000 });
    check(`primary errors (500) → answered by the fallback provider ("${viaFallback.ok ? viaFallback.provider : viaFallback.reason}")`, viaFallback.ok && viaFallback.provider === "fallback" && viaFallback.model === "local-fallback", viaFallback);

    set({ GROQ_API_KEY: "local", GROQ_BASE_URL: local, GROQ_MODEL: "bad-json", LLM_FALLBACK_API_KEY: "local", LLM_FALLBACK_BASE_URL: local, LLM_FALLBACK_MODEL: "local-fallback" });
    const json = await completeJson({ feature: "verify-llm", system: "JSON", prompt: "y", schema: z.object({ status: z.string() }), timeoutMs: 5_000 });
    check("primary returns bad JSON → the fallback's valid JSON is used", json.ok && json.provider === "fallback" && json.data.status === "ok", json);

    set({ GROQ_API_KEY: "local", GROQ_BASE_URL: local, GROQ_MODEL: "groq-local", LLM_FALLBACK_API_KEY: "local", LLM_FALLBACK_BASE_URL: local, LLM_FALLBACK_MODEL: "local-fallback", LLM_ROUTE_VERIFY: "fallback,groq" });
    check("route chain: LLM_ROUTE_VERIFY=fallback,groq puts fallback first; the default chain is unchanged", llmRoute("verify").map((p) => p.provider).join() === "fallback,groq" && llmRoute().map((p) => p.provider).join() === "groq,fallback", { route: llmRoute("verify"), default: llmRoute() });
    hits.length = 0;
    const routed = await complete({ feature: "verify-llm", route: "verify", system: "x", prompt: "y", timeoutMs: 5_000 });
    check("a routed call goes to the route's first provider only", routed.ok && routed.provider === "fallback" && hits.join() === "local-fallback", hits);

    set({ GROQ_API_KEY: "local", GROQ_BASE_URL: local, GROQ_MODEL: "always-500", LLM_FALLBACK_API_KEY: "local", LLM_FALLBACK_BASE_URL: local, LLM_FALLBACK_MODEL: "always-500" });
    const none = await complete({ feature: "verify-llm", system: "x", prompt: "y", timeoutMs: 5_000 });
    check(`every provider fails → { ok: false } with no throw ("${none.ok ? "" : none.reason}")`, !none.ok && none.kind === "error" && /all 2 providers failed/.test(none.reason), none);
  } catch (error) {
    check("routing / fallback never throws", false, error instanceof Error ? error.message : error);
  } finally {
    for (const k of KEYS) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    fake.close();
  }

  console.log(failures === 0 ? "\n✓ verify:llm passed" : `\n✗ verify:llm: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

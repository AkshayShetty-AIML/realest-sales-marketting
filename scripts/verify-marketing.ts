/**
 * MARKETING WORKSPACE — live end-to-end check (Batch M1: M1, M3, M4, M5)
 * against the REAL premium spine and the RUNNING desk:
 *
 *   npm run verify:marketing                 (desk at http://localhost:3001)
 *
 * Calls the same lib/marketing/* functions the marketing server actions call,
 * so it proves what the console does. Writes real rows on the spine: one
 * content draft, one reel (asset + job + media entry), one tiny logo, and a
 * brand-kit tone change that is put back afterwards. Nothing is published.
 */
import { buildMarketingFacts, reraLine } from "../lib/marketing/facts";
import { guardCopy } from "../lib/marketing/guard";
import { factNumbers } from "../lib/grounding/guard";
import { generateCopy, loadGrounding } from "../lib/marketing/generate";
import { CopyRejected, queueReel, saveDraft, saveKit, uploadLogo } from "../lib/marketing/studio";
import { marketing } from "../lib/premium/marketing-client";
import { premium } from "../lib/premium/client";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PROPERTY = "cedar-heights";
const ACTOR = "verify-marketing";

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}
const html = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: r.status, text: await r.text(), location: r.headers.get("location") };
};

async function main(): Promise<void> {
  console.log(`Desk ${BASE} · spine ${process.env.PREMIUM_API_BASE}\n`);

  // ── M1 ──────────────────────────────────────────────────────────────────
  console.log("M1 · Workspace switch");
  const SALES = ["/dashboard", "/inbox", "/pipeline", "/visits", "/inventory", "/sequences", "/reps", "/status"];
  const MKT = ["/marketing/dashboard", "/marketing/campaigns", "/marketing/content", "/marketing/landing-pages", "/marketing/audiences", "/marketing/brand-kit"];
  for (const p of SALES) {
    const r = await html(p);
    check(`sales ${p} → 200, sales nav only`, r.status === 200 && r.text.includes('href="/pipeline"') && !r.text.includes('href="/marketing/landing-pages"'), r.status);
  }
  for (const p of MKT) {
    const r = await html(p);
    check(`marketing ${p} → 200, marketing nav only`, r.status === 200 && r.text.includes('href="/marketing/landing-pages"') && !r.text.includes('href="/pipeline"'), r.status);
  }
  const sw = await html("/inbox");
  check("switcher on a sales page: Sales current, Marketing links to /marketing/dashboard", /aria-current="page"[^>]*href="\/dashboard"|href="\/dashboard"[^>]*aria-current="page"/.test(sw.text) && sw.text.includes('href="/marketing/dashboard"'));
  const home = await html("/marketing");
  check("/marketing → /marketing/dashboard", home.status === 307 && (home.location ?? "").endsWith("/marketing/dashboard"), home);

  // ── M3 ──────────────────────────────────────────────────────────────────
  console.log("\nM3 · Brand kit");
  const before = await marketing.getBrandKit();
  check("kit exists on the spine (seeded)", !!before?.defaultReraRegNo, before);
  const stamp = new Date().toISOString();
  let forGen: Awaited<ReturnType<typeof loadGrounding>>["kit"] = null;
  try {
    await saveKit({ toneOfVoice: `${before?.toneOfVoice ?? ""} [verify ${stamp}]`.trim() }, ACTOR);
    const reloaded = await marketing.getBrandKit();
    check("save + reload persists (tone)", !!reloaded?.toneOfVoice.includes(stamp) && reloaded.updatedBy === ACTOR, reloaded?.toneOfVoice);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const withLogo = await uploadLogo({ type: "image/png", size: png.length, bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.length) as ArrayBuffer }, ACTOR);
    const logoRead = withLogo.logoUrl ? await fetch(withLogo.logoUrl) : null;
    check("logo uploaded to Supabase Storage (signed URL) and saved on the kit", !!withLogo.logoPath && !!logoRead?.ok, withLogo.logoPath);
    forGen = (await loadGrounding(PROPERTY)).kit;
    check("kit is fetchable server-side for generation", forGen?.logoPath === withLogo.logoPath && forGen?.defaultReraRegNo === before?.defaultReraRegNo);
  } finally {
    // Always put the kit back, even if a check above throws.
    await saveKit({ toneOfVoice: before?.toneOfVoice ?? "", logoPath: before?.logoPath ?? null }, ACTOR);
  }
  check("tone + logo restored", (await marketing.getBrandKit())?.toneOfVoice === (before?.toneOfVoice ?? ""));

  // ── M4 ──────────────────────────────────────────────────────────────────
  console.log("\nM4 · Grounded Content Studio");
  const property = await premium.getProperty(PROPERTY);
  const gen = await generateCopy(PROPERTY);
  const rera = gen.grounding.reraRegNo as string;
  check("3 drafts (social post, caption, ad copy)", gen.drafts.map((d) => d.type).join() === "social_post,caption,ad_copy", gen.drafts.map((d) => d.type));
  check("engine labelled: template → \"AI-generated (demo template)\" / llm → \"AI-generated\"", gen.drafts.every((d) => (d.engine === "template" ? d.aiLabel === "AI-generated (demo template)" : d.aiLabel === "AI-generated")), gen.drafts.map((d) => d.aiLabel));
  const allowed = factNumbers(gen.grounding.facts);
  for (const d of gen.drafts) {
    const v = guardCopy(d.body, gen.grounding.facts, rera, d.type);
    check(`${d.type}: passes the claims guard`, v.ok, v.problems);
    const stray = (d.body.replace(reraLine(rera), "").match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, "")).filter((n) => !allowed.has(n));
    check(`${d.type}: every number is in the verified spine data`, stray.length === 0, stray);
    check(`${d.type}: RERA reg no. attached`, d.body.includes(reraLine(rera)));
    check(`${d.type}: no super built-up area / its per-sqft price`, !d.body.includes(String(property.areaSqft)) && !d.body.includes(property.pricePerSqftLabel.replace(/[^\d,]/g, "")) && !/built[- ]?up/i.test(d.body));
    console.log(`      ${d.body.replace(/\n/g, "\n      ")}`);
  }
  check("price only with carpet area", gen.grounding.facts.find((f) => f.key === "price")?.value.includes("carpet") ?? true);
  const noCarpet = buildMarketingFacts({ ...property, specs: {} } as typeof property, forGen);
  check("no carpet area in the data → no area, no price facts (omitted, not invented)", !noCarpet.facts.some((f) => f.key === "price" || f.key === "carpet_area") && noCarpet.warnings.some((w) => /carpet/.test(w)));
  check("no forecast / yield / reviews ever become facts", !gen.grounding.facts.some((f) => /forecast|yield|review|grade|negotia/i.test(f.key)));

  const post = gen.drafts[0];
  const edited = `${post.body.replace(reraLine(rera), "").trimEnd()} Our team will confirm visit timings.`;
  const saved = await saveDraft({ propertyId: PROPERTY, type: post.type, channel: post.channel, title: `${post.title} (verify)`, body: edited, factKeys: post.factKeys, engine: post.engine, edited: true }, ACTOR);
  check("edit → save → content_asset in status draft", saved.status === "draft", saved.status);
  check("saved with RERA reg no. re-attached + AI label (edited)", saved.reraRegNo === rera && saved.body.endsWith(reraLine(rera)) && saved.aiGenerated && /AI-generated.*edited/.test(saved.aiLabel ?? ""), saved.aiLabel);
  const listed = await marketing.listContent({ status: "draft", limit: 200 });
  check("…and it appears via GET /api/internal/marketing/content in draft", listed.some((a) => a.id === saved.id && a.status === "draft"));
  let rejected: string[] = [];
  try {
    await saveDraft({ propertyId: PROPERTY, type: "caption", channel: "facebook", title: "bad", body: "Cedar Heights: guaranteed 12% returns, best price ₹99 lakh!", factKeys: ["name"], engine: "template", edited: true }, ACTOR);
  } catch (e) {
    if (e instanceof CopyRejected) rejected = e.problems;
  }
  check("an edit with an invented price / claim is refused (not saved)", rejected.some((p) => /numbers not in/.test(p)) && rejected.some((p) => /misleading/.test(p)), rejected);

  // ── M5 ──────────────────────────────────────────────────────────────────
  console.log("\nM5 · Reel (queued stub)");
  const reel = await queueReel(PROPERTY, ACTOR);
  check("media job created, processing, demo", reel.job.kind === "reel" && reel.job.status === "processing" && reel.job.demo, reel.job);
  check("content_asset type=video, status=draft, RERA + AI label", reel.asset.type === "video" && reel.asset.status === "draft" && reel.asset.reraRegNo === rera && reel.asset.aiGenerated, reel.asset);
  const media = await marketing.listMedia({ limit: 50 });
  const entry = media.find((m) => m.jobId === reel.job.id);
  check("media library lists it as processing (demo), with no video file", entry?.status === "processing" && entry.demo && entry.storagePath === null && /processing \(demo\)/.test(entry.label), entry);
  const studio = await html("/marketing/content");
  check("Create posts lists it under Videos as \"Not made yet\"", studio.text.includes("Short video — ") && studio.text.includes("Not made yet"));

  console.log(failures === 0 ? `\nMarketing workspace checks passed (${passes}).` : `\n${failures} check(s) failed, ${passes} passed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

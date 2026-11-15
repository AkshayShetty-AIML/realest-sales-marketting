/**
 * BATCH 3, against the REAL premium app and the RUNNING desk:
 *
 *   npm run verify:batch3           (desk at SALES_BASE, default http://localhost:3001)
 *
 *  1. SCORING     the deterministic model orders evidence correctly (pure
 *                 cases), every live premium lead is scored with reasons, and the
 *                 inbox is in priority order.
 *  2. BROCHURE    a real inquiry with stated requirements → a personalised
 *                 brochure (fit table from the buyer's words, honest grade, key
 *                 facts) → a real PDF → sent in_app (in the premium thread, with
 *                 a buyer link that serves the PDF) → WhatsApp/email QUEUED
 *                 "pending Twilio" (nothing sent).
 *  3. INVENTORY   GET /inventory live with stamps; a verification moves the
 *                 stamp; an OLDER verification is refused by premium (409) and
 *                 changes nothing.
 *  4. DASHBOARD   the full funnel and every panel's numbers add up; pages render.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { premium } from "../lib/premium/client";
import type { LeadDetail, Property } from "../lib/premium/contract";
import { store } from "../lib/store";
import { resolveLink } from "../lib/links";
import { byPriority, deterministicModel } from "../lib/scoring/model";
import { scoreLeads } from "../lib/scoring/load";
import { loadInbox } from "../lib/inbox-data";
import { generateBrochure, sendBrochure } from "../lib/brochure/generate";
import { renderBrochurePdf } from "../lib/brochure/pdf";
import { loadInventory, verifyUnit } from "../lib/inventory";
import { loadDashboard } from "../lib/dashboard";
import { whatsappMode } from "../lib/whatsapp/twilio";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PREMIUM_REPO = join(process.cwd(), "..", "consumer-property-app");
const OUT = join(process.cwd(), ".data", "verify");

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}

function createInquiry(property: string, message: string): string {
  return execFileSync("npm", ["run", "-s", "dev:inquiry", "--", "--property", property, "--kind", "visit", "--message", message, "--name", "Batch Three"], { cwd: PREMIUM_REPO, encoding: "utf8" }).trim().split("\n").at(-1) ?? "";
}

// ─── 1. Scoring ─────────────────────────────────────────────────────────────

function pureScoring(property: Property) {
  console.log("\n1a. Scoring model (pure cases)");
  const now = Date.parse("2026-10-02T12:00:00Z");
  const base: LeadDetail = {
    id: "x", propertyId: property.id, kind: "general", message: "Is it available?", status: "open", stage: "inquiry", assignedTo: null, source: null, archetype: null, tags: [], buyerId: "b", listerId: "listing-desk",
    contact: { name: "Asha K", phone: null, email: null, masked: true }, createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
    context: { property: null, nextVisit: null, messageCount: 1, lastMessageAt: null }, visits: [], messages: [],
  };
  const msg = (direction: "inbound" | "outbound", at: string, body = "ok") => ({ id: at + direction, channel: "in_app", direction, body, sentBy: direction === "inbound" ? "buyer" : "rep", createdAt: at, source: "in_app_thread" as const });
  const cold = deterministicModel.score({ lead: base, property, visits: [], checkIns: [], feedback: [], optIn: null, now });
  const bhk = property.config?.match(/\d/)?.[0] ?? "3";
  const hotLead: LeadDetail = {
    ...base, kind: "visit", message: `Looking for a ${bhk} BHK, budget 50 cr`, createdAt: "2026-10-02T08:00:00Z",
    messages: [msg("inbound", "2026-10-02T08:00:00Z"), msg("outbound", "2026-10-02T08:01:00Z"), msg("inbound", "2026-10-02T09:00:00Z", "Can I visit Saturday?")],
  };
  const visit = { visitId: "v", leadId: "x", propertyId: property.id, slot: "2026-10-04T05:30:00Z", status: "confirmed" as const, source: "self-booking" as const, createdAt: "", updatedAt: "" };
  const hot = deterministicModel.score({ lead: hotLead, property, visits: [visit], checkIns: [], feedback: [], optIn: null, now });
  check(`a stale, vague inquiry scores cold (${cold.score})`, cold.band === "cold", cold);
  check(`a fresh visit inquiry that replied, fits and booked scores hot (${hot.score})`, hot.band === "hot", hot.reasons);
  check("reasons cover behaviour, fit, engagement and recency", ["behaviour", "fit", "engagement", "recency"].every((f) => hot.reasons.some((r) => r.family === f)), hot.reasons.map((r) => r.family));
  check("top reasons are the largest contributions", hot.top.length === 3 && Math.abs(hot.top[0].points) >= Math.abs(hot.top[2].points));
  const won = deterministicModel.score({ lead: { ...hotLead, status: "won" }, property, visits: [visit], checkIns: [], feedback: [], optIn: null, now });
  check("a won lead is banded closed (sinks in priority)", won.band === "closed");
  const noShow = deterministicModel.score({ lead: hotLead, property, visits: [{ ...visit, status: "no_show" }], checkIns: [], feedback: [{ id: "f", visitId: "v", leadId: "x", interest: "not_interested", objections: [], rating: null, comment: "", at: "2026-10-02T10:00:00Z", actions: [] }], optIn: null, now });
  check("a no-show + 'not interested' scores below the same lead with a booked visit", noShow.score < hot.score, [noShow.score, hot.score]);
}

async function liveScoring() {
  console.log("\n1b. Scoring live premium leads + inbox priority");
  const leads = await premium.listLeads({ limit: 200 });
  const scored = await scoreLeads(leads);
  check(`every premium lead is scored (${scored.size}/${leads.length})`, scored.size === leads.length && leads.length > 0);
  check("every score has a band and reasons", [...scored.values()].every((s) => ["hot", "warm", "cold", "closed"].includes(s.score.band) && s.score.reasons.length > 0));
  const bands = [...scored.values()].reduce<Record<string, number>>((a, s) => ((a[s.score.band] = (a[s.score.band] ?? 0) + 1), a), {});
  console.log(`     bands: ${JSON.stringify(bands)}`);
  const { rows } = await loadInbox({ score: true });
  const keyed = rows.map((r) => ({ score: r.score!, updatedAt: r.lead.context.lastMessageAt ?? r.lead.createdAt }));
  check("the inbox is sorted by priority (band → score → recency)", keyed.every((r, i) => i === 0 || byPriority(keyed[i - 1], r) <= 0));
  const html = await (await fetch(`${BASE}/inbox`)).text();
  check("the inbox page shows a Score column with score badges", html.includes(">Score<") && /score \d+\/100/.test(html));
}

// ─── 2. Brochure ────────────────────────────────────────────────────────────

async function brochure() {
  console.log("\n2. Personalised brochure");
  const property = await premium.getProperty("cedar-heights");
  const bhk = property.config?.match(/\d/)?.[0] ?? "3";
  const leadId = createInquiry("cedar-heights", `Hi, looking for a ${bhk} BHK around 1.2 cr, want to move within 12 months. Can I see it?`);
  check(`a real inquiry was created (${leadId})`, /^inq-/.test(leadId), leadId);
  const b = await generateBrochure(leadId, "verify-batch3");
  const c = b.content;
  check("the brochure is for this lead and property", b.leadId === leadId && c.property.id === property.id);
  check(`the fit table uses the buyer's own words (${c.fit.map((f) => `${f.label}:${f.verdict}`).join(", ")})`, c.fit.some((f) => f.label === "Configuration" && f.stated === `${bhk} BHK` && f.verdict === "match"));
  check("the budget row compares their stated budget to the real price", c.fit.some((f) => f.label === "Budget" && f.stated.includes("1.2") && f.verdict !== "not_stated"));
  check(`the grade is the premium grade, unrounded (${c.property.grade}, ${c.property.gradeScore})`, c.property.grade === property.grade && c.property.gradeScore === (property.gradeScore ?? null));
  check("the honest caveats are present (under construction / RERA / litigation as applicable)", property.possession === "ready" || c.thingsToCheck.some((t) => /under construction/i.test(t)));
  check("key facts come from the fact sheet", c.keyFacts.length >= 5 && c.factKeys.includes("location"));
  check(`the intro is ${b.engine === "llm" ? "AI-written and passed the guard" : `composed (${b.fallbackReason})`}`, c.intro.length > 40 && !/https?:|@/.test(c.intro));

  const pdf = await renderBrochurePdf(c);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "brochure.pdf"), pdf);
  check(`a real PDF renders (${Math.round(pdf.length / 1024)} KB → .data/verify/brochure.pdf)`, Buffer.from(pdf.slice(0, 5)).toString() === "%PDF-" && pdf.length > 10_000);

  const sent = await sendBrochure(b.id, "in_app", "verify-batch3");
  const inApp = sent.deliveries.at(-1);
  check("sent in_app → delivered", inApp?.status === "sent" && Boolean(inApp.premiumMessageId), inApp);
  const thread = await premium.getLead(leadId);
  const m = thread.messages.find((x) => x.id === inApp?.premiumMessageId);
  const token = m?.body.match(/\/b\/([A-Za-z0-9_-]+)/)?.[1];
  check("the premium thread has the brochure message with a private link", Boolean(m && token && m.channel === "in_app"), m?.body);
  if (token) {
    const link = await resolveLink(token);
    check("the link is a brochure link for this lead + brochure", link.ok && link.link.purpose === "brochure" && link.link.brochureId === b.id && link.link.leadId === leadId);
    const page = await fetch(`${BASE}/b/${token}`);
    check("the buyer page opens (no sign-in)", page.status === 200 && (await page.text()).includes("Open the full brochure"));
    const file = await fetch(`${BASE}/b/${token}/brochure.pdf`);
    const bytes = Buffer.from(await file.arrayBuffer());
    check("the buyer link serves the PDF", file.status === 200 && file.headers.get("content-type") === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-");
  }
  const bad = await fetch(`${BASE}/b/notarealtoken12345678/brochure.pdf`);
  check("a bad token gets no PDF", bad.status === 404);
  const repDl = await fetch(`${BASE}/api/brochures/${b.id}`);
  check("the rep download route serves the PDF (localhost demo session)", repDl.status === 200 && repDl.headers.get("content-type") === "application/pdf");

  const wa = await sendBrochure(b.id, "whatsapp", "verify-batch3");
  const email = await sendBrochure(b.id, "email", "verify-batch3");
  check(`WhatsApp is queued pending Twilio, not sent (mode: ${whatsappMode()})`, wa.deliveries.at(-1)?.status === "pending_twilio");
  check("email is queued pending Twilio, not sent", email.deliveries.at(-1)?.status === "pending_twilio");
  const after = await premium.getLead(leadId);
  check("only the in_app message reached the premium thread", after.messages.filter((x) => x.sentBy.startsWith("brochure:")).length === 1);
}

// ─── 3. Inventory ───────────────────────────────────────────────────────────

async function inventory() {
  console.log("\n3. Verified live inventory");
  const rows = await loadInventory();
  check(`GET /inventory is live (${rows.length} units) with stamps + freshness`, rows.length > 0 && rows.every((r) => !Number.isNaN(Date.parse(r.lastVerifiedAt)) && r.freshness));
  const unit = rows.find((r) => r.status === "available") ?? rows[0];
  const before = unit.lastVerifiedAt;
  const now = new Date().toISOString();
  const ok = await verifyUnit({ unitId: unit.unitId, status: unit.status, lastVerifiedAt: now, actor: "verify-batch3" });
  check(`verifying ${unit.unitId} (status unchanged: ${unit.status}) moves the stamp`, ok.ok && Date.parse(ok.unit.lastVerifiedAt) === Date.parse(now) && Date.parse(now) > Date.parse(before), ok);
  const older = new Date(Date.parse(now) - 86_400_000).toISOString();
  const flip = unit.status === "available" ? "sold" : "available";
  const refused = await verifyUnit({ unitId: unit.unitId, status: flip, lastVerifiedAt: older, actor: "verify-batch3" });
  check("an OLDER verification is refused by premium (409)", !refused.ok && refused.conflict, refused);
  const reread = (await premium.listInventory({ projectId: unit.projectId })).find((u) => u.unitId === unit.unitId);
  check("…and nothing changed: status and stamp are the newer check's", reread?.status === unit.status && Date.parse(reread!.lastVerifiedAt) === Date.parse(now), reread);
  const html = await (await fetch(`${BASE}/inventory`)).text();
  check("the inventory page lists units with a last-verified stamp", html.includes(unit.unitId) && html.includes("Last verified"));
}

// ─── 4. Dashboard ───────────────────────────────────────────────────────────

async function dashboard() {
  console.log("\n4. Dashboard");
  const d = await loadDashboard();
  const f = d.funnel.map((x) => x.count);
  check(`the funnel has every step (${d.funnel.map((x) => `${x.label} ${x.count}`).join(" → ")})`, d.funnel.length === 8 && f[0] === d.leads.total);
  check("stage steps never increase down the funnel", [2, 3, 4, 5, 6].every((i) => f[i] <= f[i - 1] || i === 2) && f[2] <= f[0]);
  check("pipeline sums to the open leads", d.pipeline.reduce((s, p) => s + p.count, 0) === d.leads.open);
  check("score bands sum to all leads", Object.values(d.scores).reduce((s, n) => s + n, 0) === d.leads.total);
  check(`every lead was readable (partial: ${d.partial})`, d.partial === 0);
  check("response buckets sum to all readable leads", d.response.buckets.reduce((s, b) => s + b.count, 0) === d.leads.total - d.partial);
  check(`visits: booked ${d.visits.booked} = upcoming + done + no-show + cancelled; no-show rate ${d.visits.noShowRate === null ? "n/a" : `${Math.round(d.visits.noShowRate * 100)}%`}`, d.visits.booked === d.visits.upcoming + d.visits.completed + d.visits.noShow + d.visits.cancelled);
  check("inventory statuses and freshness both sum to the units", d.inventory.available + d.inventory.blocked + d.inventory.sold === d.inventory.rows.length && d.inventory.fresh + d.inventory.ageing + d.inventory.stale === d.inventory.rows.length);
  check("the just-verified unit shows as fresh on the dashboard", d.inventory.fresh >= 1);
  const res = await fetch(`${BASE}/dashboard`);
  const html = await res.text();
  check("the dashboard page renders every panel", res.status === 200 && ["Conversion funnel", "Leads by stage", "Hot leads", "First reply", "Upcoming visits", "No-show rate", "Units available", "Recent activity"].every((t) => html.includes(t)));
}

async function main() {
  console.log(`Batch 3 — premium ${process.env.PREMIUM_API_BASE ?? "(unset)"} · desk ${BASE} · store ${store().kind} · WhatsApp ${whatsappMode()}`);
  pureScoring(await premium.getProperty("cedar-heights"));
  await liveScoring();
  await brochure();
  await inventory();
  await dashboard();
  console.log(`\n${failures === 0 ? "✓" : "✗"} ${passes}/${passes + failures} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error("✗", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

/**
 * MARKETING BATCH M2 — live end-to-end (M6 landing page, M7 capture into the
 * SHARED leads table, M8 archetype, M9 archetype nurture) against the REAL
 * premium spine and the RUNNING desk:
 *
 *   npm run verify:marketing-m2              (desk at http://localhost:3001)
 *
 * Uses the same lib/marketing/* modules the console's actions call, and reads
 * the result back through BOTH workspaces over HTTP (sales inbox + lead page,
 * marketing campaign view). Writes real rows: one draft landing page and two
 * test leads (fictional example.com contacts) with their nurture messages —
 * in-app to their own threads, email only to their example.com address and
 * only if a provider is configured. No broadcast. Time-based steps run with a
 * MOVED CLOCK for this script's own leads only (same approach as verify:batch2).
 */
import { premium } from "../lib/premium/client";
import { marketing } from "../lib/premium/marketing-client";
import { store } from "../lib/store";
import { CONSENT_TEXT, captureLead, generateLandingPage, landingContent } from "../lib/marketing/capture";
import { archetypePreviews, enrolLead } from "../lib/marketing/nurture";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PROPERTY = "cedar-heights";
const CAMPAIGN = "camp-cedar-launch";
const ACTOR = "verify-marketing-m2";

let failures = 0;
let passes = 0;
const notRun: string[] = [];
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}
const html = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
  // React splits adjacent text nodes with <!-- --> — strip it so text checks read naturally.
  return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, "") };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`Desk ${BASE} · spine ${process.env.PREMIUM_API_BASE}\n`);
  const kit = await marketing.getBrandKit();
  const rera = kit?.defaultReraRegNo ?? "";

  // ── M6 ──────────────────────────────────────────────────────────────────
  console.log("M6 · Per-project landing page");
  const property = await premium.getProperty(PROPERTY);
  const page = await generateLandingPage(PROPERTY, ACTOR, CAMPAIGN);
  const content = landingContent(page);
  check("generated + saved as a landing_pages row in status draft", page.status === "draft" && page.campaignId === CAMPAIGN && page.propertyId === PROPERTY, page.status);
  check("RERA reg no. on the page (row + content)", page.reraRegNo === rera && content.rera.regNo === rera);
  check("pricing is carpet-area pricing", !!content.pricing && content.pricing.carpetArea.includes("carpet") && !JSON.stringify(content).includes(String(property.areaSqft)), content.pricing);
  check("honest grade shown as the spine states it", content.grade?.grade === property.grade && content.grade?.score === (property.gradeScore ?? null), content.grade);
  check("hero media from the spine, placeholders labelled", content.hero.media.length > 0 && content.hero.media.every((m) => !m.placeholder || /Placeholder/.test(m.label)), content.hero.media.map((m) => m.label));
  check("amenities only from verified data (none invented)", content.amenities.every((a) => (property.amenities ?? []).some((x) => (x.name ?? x.kind.replace(/-/g, " ")) === a)), content.amenities);
  check("register-interest + lead magnets offered", ["brochure", "price_list", "eligibility", "register_interest"].every((m) => content.magnets.includes(m as never)));
  const listed = await marketing.listLandingPages({ status: "draft", limit: 200 });
  check("…exists via GET /api/internal/marketing/landing-pages in draft", listed.some((p) => p.id === page.id && p.status === "draft"));
  const preview = await html(`/marketing/landing-pages/${encodeURIComponent(page.id)}`);
  check("operator preview renders (headline, price, grade, RERA, capture form)", preview.status === 200 && preview.text.includes(content.hero.headline) && preview.text.includes(rera) && preview.text.includes("Honest grade") && preview.text.includes("Interested in this home?"), preview.status);
  check("public /b/lp/<slug> is 404 while the page is a draft (publishing gated)", (await html(`/b/lp/${page.slug}`)).status === 404);

  // ── M7 ──────────────────────────────────────────────────────────────────
  console.log("\nM7 · Lead capture into the SHARED leads table");
  const stamp = Date.now().toString(36);
  const capture = await captureLead({
    page,
    magnet: "price_list",
    contact: { name: "Meera Capture", phone: "+91 90000 00042", email: `capture-${stamp}@example.com` },
    consent: { in_app: true, email: true, whatsapp: true, sms: false, text: CONSENT_TEXT },
    utm: { source: "instagram", medium: "paid_social", campaign: "cedar-heights-launch", content: `verify-${stamp}` },
    source: "landing_page",
    answers: { purpose: "invest", residence: "same_city", firstHome: "no", household: "other", currentHome: "own_keep" },
  });
  const leadA = capture.lead;
  console.log(`    captured lead ${leadA.leadId}`);
  check("capture → one lead with campaign_id, source, utm, attributed_at", leadA.campaignId === CAMPAIGN && leadA.source === "landing_page" && leadA.utm.source === "instagram" && leadA.utm.campaign === "cedar-heights-launch" && !!leadA.attributedAt, leadA);
  check("consent captured per channel, with its wording and time", leadA.consent?.in_app === true && leadA.consent.email === true && leadA.consent.whatsapp === true && leadA.consent.sms === false && leadA.consent.text === CONSENT_TEXT && !!leadA.consent.at, leadA.consent);
  check("price-list magnet fulfilled from verified inventory", capture.result.magnet === "price_list" && capture.result.list.note.includes("carpet"), capture.result);
  const fromSales = await premium.listLeads({ limit: 200 });
  const salesView = fromSales.find((l) => l.id === leadA.leadId);
  check("the SAME lead is in the sales contract (GET /api/internal/leads), contact masked", !!salesView && salesView.contact.masked && salesView.propertyId === PROPERTY, salesView?.contact);
  let inbox = await html("/inbox");
  for (let i = 0; i < 6 && !inbox.text.includes(leadA.leadId); i++) {
    await sleep(2000);
    inbox = await html("/inbox");
  }
  const rowAt = inbox.text.indexOf(`/leads/${encodeURIComponent(leadA.leadId)}`);
  const row = rowAt >= 0 ? inbox.text.slice(rowAt, rowAt + 4000) : "";
  check("SALES DESK inbox lists it", rowAt >= 0);
  check("…tagged with its campaign and source", row.includes("Campaign: Cedar Heights · Enquiries · Oct 2026") && row.includes("Source: landing page · instagram"), row.slice(0, 400));
  const leadPage = await html(`/leads/${encodeURIComponent(leadA.leadId)}`);
  check("sales lead page shows the campaign tag", leadPage.status === 200 && leadPage.text.includes("Campaign: Cedar Heights · Enquiries · Oct 2026"), leadPage.status);
  const campaignView = await html(`/marketing/campaigns/${CAMPAIGN}`);
  check("…and it shows under the campaign in the MARKETING workspace", campaignView.status === 200 && campaignView.text.includes(leadA.leadId), campaignView.status);
  const campaignRow = (await marketing.listCampaigns()).find((c) => c.id === CAMPAIGN);
  check("campaign lead count comes from the shared table", (campaignRow?.leads.total ?? 0) >= 1, campaignRow?.leads);

  const capB = await captureLead({
    page,
    magnet: "brochure",
    contact: { name: "Rahul Capture", email: `capture-b-${stamp}@example.com` },
    consent: { in_app: true, email: true, whatsapp: false, sms: false, text: CONSENT_TEXT },
    utm: { source: "facebook", medium: "paid_social", campaign: "cedar-heights-launch" },
    source: "landing_page",
  });
  const leadB = capB.lead;
  console.log(`    captured lead ${leadB.leadId}`);
  const brochure = capB.result.magnet === "brochure" ? await fetch(capB.result.url) : null;
  check("brochure magnet: a working private brochure link for the new lead", !!brochure?.ok, brochure?.status);

  // ── M8 ──────────────────────────────────────────────────────────────────
  console.log("\nM8 · Archetype questionnaire");
  check("quiz at capture → archetype stored on the lead (invest → investor)", leadA.archetype === "investor" && leadA.archetypeReason === "buying to rent out / invest", leadA.archetype);
  check("a capture without the quiz has no archetype yet", leadB.archetype === null);
  const later = await marketing.setArchetype(leadB.leadId, { purpose: "live", residence: "abroad", firstHome: "no", household: "family", currentHome: "own_keep" }, ACTOR);
  check("quiz later → archetype set (lives abroad → nri)", later.archetype === "nri" && !!later.archetypeAt, later.archetype);
  check("deterministic: same answers, same archetype", (await marketing.setArchetype(leadB.leadId, { purpose: "live", residence: "abroad", firstHome: "no", household: "family", currentHome: "own_keep" }, ACTOR)).archetype === "nri");
  const inbox2 = await html("/inbox");
  const rowB = inbox2.text.slice(inbox2.text.indexOf(`/leads/${encodeURIComponent(leadB.leadId)}`), inbox2.text.indexOf(`/leads/${encodeURIComponent(leadB.leadId)}`) + 4000);
  check("archetype visible in the SALES desk (inbox tag)", rowB.includes("NRI"), rowB.slice(0, 300));
  check("archetype visible on the sales lead page", (await html(`/leads/${encodeURIComponent(leadA.leadId)}`)).text.includes("Investor"));
  const cv2 = await html(`/marketing/campaigns/${CAMPAIGN}`);
  check("archetype visible in the campaign view", cv2.text.includes("NRI") && cv2.text.includes("Investor"));

  // ── M9 ──────────────────────────────────────────────────────────────────
  console.log("\nM9 · Personalised sequences per archetype");
  const previews = await archetypePreviews();
  const allText = previews.flatMap((p) => p.steps.map((s) => s.text)).join("\n");
  check("a sequence for every archetype (in_app + email + WhatsApp)", previews.every((p) => p.sequence && ["in_app", "email", "whatsapp"].every((c) => p.steps.some((s) => s.channel === c))), previews.map((p) => [p.archetype, p.steps.map((s) => s.channel)]));
  check("previews are RENDERED (\"Hi Meera,\" …) — no raw {{merge_fields}}", allText.includes("Hi Meera,") && !allText.includes("{{") && !allText.includes("}}"));
  const inv = previews.find((p) => p.archetype === "investor")!.steps[0].text;
  const fam = previews.find((p) => p.archetype === "end_user_family")!.steps[0].text;
  check("investors hear yield (labelled an estimate)", /rental yield is 3\.3% a year \(a platform estimate/.test(inv), inv);
  check("families hear community / amenities; schools & safety go to a colleague (no invented schools)", /gated community|amenities/i.test(fam) && /schools and safety/i.test(fam) && !/school\b(?!s and)/i.test(fam.replace(/schools and safety/gi, "")), fam);
  console.log(`      investor (in-app): ${inv}`);
  console.log(`      family (in-app):   ${fam}`);

  const jobsBefore = (await store().listJobs({ leadId: leadA.leadId })).length;
  const enrolled = await enrolLead(CAMPAIGN, leadA.leadId, ACTOR);
  check("enrol → the investor sequence is chosen", enrolled.sequence.params.archetype === "investor", enrolled.sequence.id);
  const enrolments = await marketing.listEnrolments({ campaignId: CAMPAIGN, leadId: leadA.leadId });
  check("enrolment recorded on the spine", enrolments.length === 1 && enrolments[0].archetype === "investor");
  // Since Step 3 (one send path): enrolling never starts an unapproved sales-engine run. The steps are proposed as
  // approvals by the marketing harness (scripts/verify-harness.ts §11 covers delivery: in_app live, external dry-run).
  check("no unapproved sends: enrolling queued no sales-engine jobs", (await store().listJobs({ leadId: leadA.leadId })).length === jobsBefore);
  check("enrolling needs an archetype (refused without one)", await enrolLead(CAMPAIGN, (await captureLead({ page, magnet: "register_interest", contact: { name: "Noquiz Capture", email: `noquiz-${stamp}@example.com` }, consent: { in_app: true, email: false, whatsapp: false, sms: false, text: CONSENT_TEXT } })).lead.leadId, ACTOR).then(() => false, (e) => /questions/.test(String(e))));

  console.log(failures === 0 ? `\nBatch M2 checks passed (${passes})${notRun.length ? `, ${notRun.length} not run` : ""}.` : `\n${failures} check(s) failed, ${passes} passed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

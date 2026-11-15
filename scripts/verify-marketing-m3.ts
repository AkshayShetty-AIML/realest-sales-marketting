/**
 * MARKETING BATCH M3 — live end-to-end (M12 approval gate + RERA, M10
 * distribution & scheduling, M11 marketing → booking attribution) against
 * the REAL premium spine and the RUNNING desk:
 *
 *   npm run verify:marketing-m3              (desk at http://localhost:3001)
 *
 * Creates its OWN campaign, segment, landing page, test leads (fictional
 * example.com contacts) and content, so every number it checks is exact.
 *
 * EMAIL: no provider is configured in this environment, so this script
 * points ITS OWN process's EMAIL_WEBHOOK_URL at a LOCAL MAIL CATCHER (an HTTP
 * endpoint that records what the email seam POSTs: { to, subject, text }).
 * That proves segmentation, consent, rendering and the transport contract —
 * not inbox delivery. The running desk's settings are not touched.
 * Social publishing is a stub by design (no social API is called).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { premium } from "../lib/premium/client";
import { PremiumError } from "../lib/premium/client";
import { marketing } from "../lib/premium/marketing-client";
import { store } from "../lib/store";
import { CONSENT_TEXT, captureLead, generateLandingPage } from "../lib/marketing/capture";
import { generateCopy } from "../lib/marketing/generate";
import { saveDraft } from "../lib/marketing/studio";
import { approver, move } from "../lib/marketing/approval";
import { standardCampaignName } from "../lib/marketing/labels";
import { BroadcastBlocked, draftBroadcast, publishDue, sendBroadcast } from "../lib/marketing/distribution";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PROPERTY = "cedar-heights";
const ACTOR = "verify-marketing-m3";

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}
const html = async (path: string) => {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
  return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, "") };
};
/** Runs `fn`, expecting the spine to refuse with 409; returns the refusal. */
async function refused(fn: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof PremiumError && e.status === 409) return { code: e.code, message: e.message };
    if (e instanceof BroadcastBlocked) return { code: "blocked_locally", message: e.message };
    throw e;
  }
}

async function main(): Promise<void> {
  // ── Local mail catcher (this process only) ────────────────────────────
  const inbox: { to: string; subject: string; text: string }[] = [];
  const catcher = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      inbox.push(JSON.parse(raw));
      res.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((r) => catcher.listen(0, "127.0.0.1", r));
  process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${(catcher.address() as AddressInfo).port}/send`;
  console.log(`Desk ${BASE} · spine ${process.env.PREMIUM_API_BASE}`);
  console.log(`Email → LOCAL MAIL CATCHER ${process.env.EMAIL_WEBHOOK_URL} (no real provider configured)\n`);

  const stamp = Date.now().toString(36);
  const kit = await marketing.getBrandKit();
  const rera = kit?.defaultReraRegNo as string;

  // ── M12 ─────────────────────────────────────────────────────────────────
  console.log("M12 · Approval gate + RERA compliance");
  const gen = await generateCopy(PROPERTY, ["social_post", "caption"]);
  const a = await saveDraft({ propertyId: PROPERTY, ...gen.drafts[0], title: `${gen.drafts[0].title} (m3 ${stamp})`, edited: false }, ACTOR);
  check("a new asset is born draft", a.status === "draft");
  const pubDraft = await refused(() => move("content", a.id, "published", ACTOR, { publishChannels: ["instagram"] }));
  check("publishing a DRAFT is blocked", pubDraft?.code === "illegal_transition", pubDraft);
  const schedDraft = await refused(() => move("content", a.id, "scheduled", ACTOR, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), publishChannels: ["instagram"] }));
  check("scheduling a draft is blocked", schedDraft?.code === "illegal_transition", schedDraft);
  await move("content", a.id, "submitted", ACTOR);
  const pubSubmitted = await refused(() => move("content", a.id, "published", ACTOR, { publishChannels: ["instagram"] }));
  check("publishing a SUBMITTED (unapproved) asset is blocked", pubSubmitted?.code === "illegal_transition", pubSubmitted);
  const approved = await move("content", a.id, "approved", ACTOR);
  check(`submit → approve (operator stub on the builder's behalf, via ${approver.via})`, approved.object.status === "approved" && approved.checks.length > 0 && approved.checks.every((c) => c.ok), approved.checks);
  const published = await move("content", a.id, "published", ACTOR, { publishChannels: ["instagram", "facebook"] });
  check("approved → publish is allowed", published.object.status === "published");
  const pubs = await marketing.listPublications({ assetId: a.id });
  check("…as a STUB: one publication per channel, no external post id", pubs.length === 2 && pubs.every((p) => p.status === "stub_published" && p.externalId === null), pubs);
  const back = await refused(() => move("content", a.id, "draft", ACTOR));
  check("published is final", back?.code === "illegal_transition", back);

  // RERA gate
  const noLine = await marketing.createContent({ type: "caption", title: `m3 no RERA line ${stamp}`, body: "Cedar Heights, Hebbal: 3 BHK, 1,240 sq ft carpet area.", propertyId: PROPERTY, createdBy: ACTOR });
  await move("content", noLine.id, "submitted", ACTOR);
  const r1 = await refused(() => move("content", noLine.id, "approved", ACTOR));
  check("approval blocked when the copy doesn't show the RERA reg. no.", r1?.code === "approval_blocked" && /RERA/.test(r1.message), r1);
  const superBuilt = await marketing.createContent({ type: "caption", title: `m3 super built-up ${stamp}`, body: `Cedar Heights: 1,550 sq ft super built-up, ₹1.15 Cr.\nRERA Reg. No.: ${rera}`, propertyId: PROPERTY, createdBy: ACTOR });
  await move("content", superBuilt.id, "submitted", ACTOR);
  const r2 = await refused(() => move("content", superBuilt.id, "approved", ACTOR));
  check("approval blocked on super built-up pricing (carpet-area rule)", r2?.code === "approval_blocked" && /super built-up/.test(r2.message), r2);
  const misleading = await marketing.createContent({ type: "caption", title: `m3 misleading ${stamp}`, body: `Cedar Heights — guaranteed appreciation, best price in Hebbal!\nRERA Reg. No.: ${rera}`, propertyId: PROPERTY, createdBy: ACTOR });
  await move("content", misleading.id, "submitted", ACTOR);
  const r3 = await refused(() => move("content", misleading.id, "approved", ACTOR));
  check("approval blocked on a misleading claim", r3?.code === "approval_blocked" && /misleading/.test(r3.message), r3);
  const unlabeled = await marketing.createContent({ type: "caption", title: `m3 AI unlabelled ${stamp}`, body: `Cedar Heights, Hebbal.\nRERA Reg. No.: ${rera}`, propertyId: PROPERTY, aiGenerated: true, aiLabel: "AI-generated", createdBy: ACTOR });
  check("AI-generated content always carries its label (the API refuses one without)", unlabeled.aiLabel === "AI-generated");

  const campaign = await marketing.createCampaign({ name: `${standardCampaignName("Cedar Heights", "bookings", new Date().toISOString().slice(0, 7))} (test ${stamp})`, objective: "bookings", propertyId: PROPERTY, channels: ["social", "email", "whatsapp"], budgetInr: 50000, utmCampaign: `m3-verify-${stamp}`, createdBy: ACTOR });
  await move("campaign", campaign.id, "submitted", ACTOR);
  try {
    await marketing.saveBrandKit({ defaultReraRegNo: null, updatedBy: ACTOR });
    const r4 = await refused(() => move("campaign", campaign.id, "approved", ACTOR));
    check("approval WITHOUT a project RERA reg. no. is blocked", r4?.code === "approval_blocked" && /RERA/.test(r4.message), r4);
  } finally {
    await marketing.saveBrandKit({ defaultReraRegNo: rera, updatedBy: ACTOR });
  }
  const campOk = await move("campaign", campaign.id, "approved", ACTOR);
  check("…and allowed once the RERA reg. no. is back", campOk.object.status === "approved");
  await move("campaign", campaign.id, "published", ACTOR);

  const auditA = await marketing.listAudit({ objectId: a.id });
  const approval = auditA.find((x) => x.action === "approved");
  check("every approval is logged: who, when, via operator_stub, with its checks", !!approval && approval.actor === ACTOR && approval.approvalVia === "operator_stub" && !!approval.at && (approval.checks ?? []).length > 0, approval);
  check("…and every move: draft → submitted → approved → published", ["moved_to_submitted", "approved", "moved_to_published"].every((k) => auditA.some((x) => x.action === k)), auditA.map((x) => x.action));
  const blockedLog = await marketing.listAudit({ objectId: noLine.id });
  check("refused approvals are logged too (ok=false, with the failing check)", blockedLog.some((x) => x.action === "approval_blocked" && !x.ok && (x.checks ?? []).some((c) => !c.ok)), blockedLog.map((x) => x.action));
  check("Approvals page renders the queue + activity", (await html("/marketing/approvals")).text.includes("Activity"));

  // Landing page: public only once published.
  const page = await generateLandingPage(PROPERTY, ACTOR, campaign.id);
  check("landing page draft → public URL 404", (await html(`/b/lp/${page.slug}`)).status === 404);
  await move("landing_page", page.id, "submitted", ACTOR);
  await move("landing_page", page.id, "approved", ACTOR);
  check("approved but not published → still 404", (await html(`/b/lp/${page.slug}`)).status === 404);
  await move("landing_page", page.id, "published", ACTOR);
  const live = await html(`/b/lp/${page.slug}?utm_source=instagram`);
  check("published → the public page is live, RERA reg. no. on it", live.status === 200 && live.text.includes(rera), live.status);

  // ── M10 ─────────────────────────────────────────────────────────────────
  console.log("\nM10 · Distribution & scheduling");
  const b = await saveDraft({ propertyId: PROPERTY, ...gen.drafts[1], title: `${gen.drafts[1].title} (m3 calendar ${stamp})`, edited: false }, ACTOR);
  await move("content", b.id, "submitted", ACTOR);
  await move("content", b.id, "approved", ACTOR);
  const when = new Date(Date.now() + 120_000).toISOString();
  const sched = await move("content", b.id, "scheduled", ACTOR, { scheduledAt: when, publishChannels: ["instagram", "linkedin", "youtube"] });
  check("approved post → scheduled (Instagram, LinkedIn, YouTube)", sched.object.status === "scheduled");
  const cal = await html("/marketing/calendar");
  check("…it sits in the calendar as scheduled", cal.status === 200 && cal.text.includes(b.title) && cal.text.includes("Scheduled"));
  const early = await publishDue(new Date());
  check("not published before its time", !early.published.includes(b.id));
  const due = await publishDue(new Date(Date.parse(when) + 60_000), ACTOR);
  check("at its time the scheduler publishes it (post-approval)", due.published.includes(b.id), due);
  const bp = await marketing.listPublications({ assetId: b.id });
  check("…stub publications on all 3 channels, nothing posted", bp.length === 3 && bp.every((p) => p.externalId === null && /stub/.test(p.note ?? "")), bp.map((p) => p.channel));
  check("calendar shows it published", (await html("/marketing/calendar")).text.includes("marked published"));

  // Test audience: our own captured leads on THIS campaign (example.com), with and without consent.
  const L = async (name: string, utm: string, consent: { email: boolean; whatsapp: boolean }, phone?: string) =>
    (await captureLead({ page, magnet: "register_interest", contact: { name, email: `${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}@example.com`, phone }, consent: { in_app: true, sms: false, ...consent, text: CONSENT_TEXT }, utm: { source: utm, medium: "paid_social", campaign: campaign.utmCampaign ?? undefined }, source: "landing_page" })).lead;
  const lead1 = await L("Meera Mthree", "instagram", { email: true, whatsapp: true }, "+91 90000 00071");
  const lead2 = await L("Arjun Mthree", "facebook", { email: false, whatsapp: false });
  const lead3 = await L("Kavya Mthree", "instagram", { email: true, whatsapp: false });
  console.log(`    test leads ${lead1.leadId}, ${lead2.leadId}, ${lead3.leadId}`);
  const seg = await marketing.createSegment({ name: `M3 test segment ${stamp}`, description: "verify:marketing-m3 — this run's example.com leads only", rules: { campaignId: campaign.id, emailDomain: "example.com" }, createdBy: ACTOR });

  const mail = await draftBroadcast({ segmentId: seg.id, channel: "email", name: `M3 email ${stamp}`, subject: "Cedar Heights: site visits this weekend", body: "Hi {{firstName|there}}, {{property}} in {{locality}} is open for site visits this weekend: {{price|price on request}} for {{carpetArea|the listed carpet area}}.", campaignId: campaign.id }, ACTOR);
  const notApproved = await refused(() => sendBroadcast(mail.id, ACTOR));
  check("an email campaign can't send before approval", !!notApproved && inbox.length === 0, notApproved);
  const spineRefuses = await refused(() => marketing.recordDeliveries(mail.id, { actor: ACTOR, results: [{ leadId: lead1.leadId, status: "sent" }] }));
  check("…and the spine refuses to record one (409 not_approved)", spineRefuses?.code === "not_approved", spineRefuses);
  await move("broadcast", mail.id, "submitted", ACTOR);
  await move("broadcast", mail.id, "approved", ACTOR);
  const aud = await marketing.audience(mail.id);
  check("segment → only CONSENTED leads with an email (2 of 3)", aud.matched === 3 && aud.eligible.length === 2 && aud.skipped.noConsent === 1 && !aud.eligible.includes(lead2.leadId), aud);
  const sent = await sendBroadcast(mail.id, ACTOR);
  check("approved email campaign SENDS to the test segment", sent.status === "published" && sent.deliveries.sent === 2, sent.deliveries);
  const toMeera = inbox.find((m) => m.to === `meera-mthree-${stamp}@example.com`);
  check("…2 emails left through the email seam, to the consented addresses only", inbox.length === 2 && !!toMeera && !inbox.some((m) => m.to.startsWith("arjun")), inbox.map((m) => m.to));
  check("…rendered per lead from verified data, RERA line included, no {{fields}}", !!toMeera && toMeera.text.startsWith("Hi Meera,") && toMeera.text.includes("1,240 sq ft carpet area") && toMeera.text.includes(`RERA Reg. No.: ${rera}`) && !toMeera.text.includes("{{"), toMeera?.text);
  const thread = await premium.getLead(lead1.leadId);
  check("…and logged on the lead's thread (channel email)", thread.messages.some((m) => m.channel === "email" && m.body.includes("site visits this weekend")));

  const wa = await draftBroadcast({ segmentId: seg.id, channel: "whatsapp", name: `M3 WhatsApp ${stamp}`, body: "Hi {{firstName|there}}, site visits at {{property}} are open this weekend.", waTemplateName: "site_visit_weekend", waTemplateLanguage: "en", waTemplateVariables: ["firstName", "property"], campaignId: campaign.id }, ACTOR);
  check("WhatsApp broadcast created with opt-in + template fields", wa.status === "draft" && wa.waTemplate?.name === "site_visit_weekend" && wa.waTemplate.language === "en");
  await move("broadcast", wa.id, "submitted", ACTOR);
  await move("broadcast", wa.id, "approved", ACTOR);
  const waAud = await marketing.audience(wa.id);
  check("…audience = WhatsApp opt-ins with a phone only (1 of 3)", waAud.eligible.length === 1 && waAud.eligible[0] === lead1.leadId, waAud);
  const waSent = await sendBroadcast(wa.id, ACTOR);
  check("…sent = QUEUED (pending Twilio), nothing went to Twilio", waSent.deliveries.pending_twilio === 1 && !waSent.deliveries.sent, waSent.deliveries);
  const waJob = (await store().listJobs({ leadId: lead1.leadId })).find((j) => j.source === `broadcast:${wa.id}`);
  check("…on the sales timeline as pending Twilio, with its template", waJob?.status === "pending_twilio" && /site_visit_weekend/.test(waJob.note ?? ""), waJob?.note);

  // ── M11 ─────────────────────────────────────────────────────────────────
  console.log("\nM11 · Campaign dashboard + marketing → booking attribution");
  await marketing.addSpend({ campaignId: campaign.id, channel: "instagram", amountInr: 30000, reach: 50000, source: "manual", enteredBy: ACTOR });
  await marketing.addSpend({ campaignId: campaign.id, channel: "facebook", amountInr: 20000, reach: 30000, source: "builder_passthrough", enteredBy: ACTOR });
  // Advance lead1 to a completed site visit and a BOOKING, lead2 to a completed visit — in the spine, through the sales contract.
  const slot = new Date(Date.now() + 86_400_000).toISOString();
  const v1 = await premium.createVisit({ leadId: lead1.leadId, slot, createdBy: ACTOR });
  await premium.patchVisit(v1.id, "completed");
  await premium.patchLead(lead1.leadId, { stage: "booking" });
  const v2 = await premium.createVisit({ leadId: lead2.leadId, slot, createdBy: ACTOR });
  await premium.patchVisit(v2.id, "completed");
  const rep = await marketing.attribution({ campaignId: campaign.id });
  const m = rep.campaigns[0];
  console.log(`    spend ₹${m.spendInr} · reach ${m.reach} · leads ${m.leads} · site visits ${m.siteVisits} · bookings ${m.bookings}`);
  console.log(`    cost/lead ₹${m.costPerLead} · cost/site visit ₹${m.costPerSiteVisit} · cost/booking ₹${m.costPerBooking}`);
  check("spend ₹50,000 + reach 80,000 (manual + builder pass-through)", m.spendInr === 50000 && m.reach === 80000, m);
  check("3 leads joined by campaign_id from the shared leads table", m.leads === 3);
  check("2 site visits (completed visits joined to those leads)", m.siteVisits === 2);
  check("1 booking (lead advanced to stage booking in the spine)", m.bookings === 1);
  check("cost per lead = 50,000 / 3 = ₹16,666.67", m.costPerLead === 16666.67, m.costPerLead);
  check("cost per site visit = 50,000 / 2 = ₹25,000", m.costPerSiteVisit === 25000, m.costPerSiteVisit);
  check("COST PER BOOKING = 50,000 / 1 = ₹50,000", m.costPerBooking === 50000, m.costPerBooking);
  const ig = rep.channels.find((c) => c.channel === "instagram");
  const fb = rep.channels.find((c) => c.channel === "facebook");
  check("by channel — Instagram: ₹30,000, 2 leads, 1 visit, 1 booking → ₹15,000/lead, ₹30,000/booking", ig?.spendInr === 30000 && ig.leads === 2 && ig.siteVisits === 1 && ig.bookings === 1 && ig.costPerLead === 15000 && ig.costPerBooking === 30000, ig);
  check("by channel — Facebook: ₹20,000, 1 lead, 1 visit, 0 bookings → no cost/booking", fb?.spendInr === 20000 && fb.leads === 1 && fb.siteVisits === 1 && fb.bookings === 0 && fb.costPerBooking === null, fb);
  const dash = await html("/marketing/dashboard");
  const row = dash.text.slice(dash.text.indexOf(`data-campaign="${campaign.id}"`), dash.text.indexOf(`data-campaign="${campaign.id}"`) + 3000);
  check("the dashboard shows it: cost/lead ₹16,667 · cost/visit ₹25,000 · cost/booking ₹50,000", row.includes("₹16,667") && row.includes("₹25,000") && row.includes("₹50,000"), row.slice(0, 300));
  const cview = await html(`/marketing/campaigns/${encodeURIComponent(campaign.id)}`);
  check("campaign view shows cost per booking", cview.text.includes("Cost per booking") && cview.text.includes("₹50,000"));

  catcher.close();
  console.log(failures === 0 ? `\nBatch M3 checks passed (${passes}).` : `\n${failures} check(s) failed, ${passes} passed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

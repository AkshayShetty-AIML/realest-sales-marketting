/**
 * BATCH 2, end to end, against the REAL premium app and the RUNNING desk:
 *
 *   npm run verify:batch2           (desk at SALES_BASE, default http://localhost:3001)
 *
 * A real inquiry → instant reply + post-inquiry sequence → booking link (in_app,
 * in the premium thread) → self-booking with auto-confirm (POST /visits + PATCH
 * confirmed, stage visit_scheduled) → one-tap reschedule → pre-visit reminders
 * in_app (WhatsApp copy queued "pending Twilio") → geotag check-in (off-site
 * refused, on-site completes the visit) → feedback form in_app → feedback with an
 * objection → the targeted nudge fires. Then a second lead: no-show detected →
 * recovery sequence fires.
 *
 * Time-based steps run with a MOVED CLOCK, and only this script's own leads'
 * jobs are executed — no other lead is touched. Uses the same server modules
 * the buyer pages and desk actions call; the buyer pages are also fetched over HTTP.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { premium } from "../lib/premium/client";
import { store } from "../lib/store";
import { resolveLink } from "../lib/links";
import { executeJob } from "../lib/automation/engine";
import { bookVisit, checkIn, detectNoShows, rescheduleVisit, submitFeedback, visitSettings } from "../lib/automation/visits";
import { sendNow } from "../lib/automation/delivery";
import { renderFor } from "../lib/automation/vars";
import { availableSlots } from "../lib/scheduling/slots";
import { istParts, formatIst } from "../lib/scheduling/time";

const BASE = (process.env.SALES_BASE ?? "http://localhost:3001").replace(/\/+$/, "");
const PREMIUM_REPO = join(process.cwd(), "..", "consumer-property-app");

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function createInquiry(property: string, message: string): string {
  return execFileSync("npm", ["run", "-s", "dev:inquiry", "--", "--property", property, "--kind", "visit", "--message", message, "--name", "Batch Two"], { cwd: PREMIUM_REPO, encoding: "utf8" }).trim().split("\n").at(-1) ?? "";
}

async function waitForReply(leadId: string): Promise<boolean> {
  for (let i = 0; i < 60; i += 1) {
    if ((await store().listAudit(leadId, 30)).some((e) => e.kind === "auto-reply")) return true;
    await sleep(500);
  }
  return false;
}

/** Runs this lead's jobs that are due at `now` (moved clock). */
async function runLeadJobs(leadId: string, now: Date): Promise<string[]> {
  const out: string[] = [];
  for (const job of await store().listJobs({ leadId, status: "pending", dueBefore: now.toISOString() })) out.push(`${job.channel}:${await executeJob(job, now)}`);
  return out;
}

const linkIn = (text: string) => text.match(/https?:\/\/\S+\/b\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
const lastOut = async (leadId: string) => (await premium.getLead(leadId)).messages.filter((m) => m.direction === "outbound").at(-1);

/** A slot at 11:00 IST at least 30 h out — so the -24 h and -2 h reminders are both in the future and in sending hours. */
async function pickSlot(propertyId: string, after?: string): Promise<string> {
  const days = availableSlots(new Date(), await visitSettings(), propertyId, await store().listVisits({ propertyId }));
  const s = days.flatMap((d) => d.slots).find((x) => istParts(new Date(x.start)).hour === 11 && Date.parse(x.start) > Date.now() + 30 * 3_600_000 && (!after || x.start > after));
  if (!s) throw new Error("no 11:00 slot available");
  return s.start;
}

async function main(): Promise<void> {
  console.log(`Desk ${BASE} · premium ${process.env.PREMIUM_API_BASE}\n`);

  console.log("1 · New inquiry → instant reply → post-inquiry sequence");
  const leadId = createInquiry("cedar-heights", "Can I come and see the 3 BHK this week? (batch-2 test)");
  console.log(`    lead ${leadId}`);
  check("instant reply sent by the desk", await waitForReply(leadId));
  // The reply is audited before routing and the sequence start — wait for the run itself.
  let post = null;
  for (let i = 0; i < 30 && !post; i += 1) {
    post = (await store().listRuns({ leadId })).find((r) => r.sequenceId === "seq-post-inquiry") ?? null;
    if (!post) await sleep(500);
  }
  check("post-inquiry sequence started", post?.status === "active", post);
  check("its WhatsApp step is scheduled (will queue, not send)", (await store().listJobs({ leadId, status: "pending" })).some((j) => j.channel === "whatsapp"));

  console.log("\n2 · Self-booking link, in_app");
  const lead = await premium.getLead(leadId);
  await sendNow(leadId, "in_app", await renderFor("Pick a time to visit {{property}}: {{bookingLink}}", { lead }), "verify-batch2");
  const bookingMsg = await lastOut(leadId);
  const bookToken = bookingMsg ? linkIn(bookingMsg.body) : null;
  check("booking link delivered to the premium thread (in_app)", !!bookToken && bookingMsg?.channel === "in_app");
  const page = await fetch(`${BASE}/b/${bookToken}`);
  const html = await page.text();
  check("buyer's booking page opens (calendar + slots)", page.status === 200 && html.includes("Pick a day") && html.includes("Book this visit"));
  check("…shows no contact details", !/@example\.com|\+91/.test(html));

  console.log("\n3 · Book → auto-confirm → stage visit_scheduled → confirmation in_app");
  const resolved = await resolveLink(bookToken!);
  check("token resolves to this lead, purpose book", resolved.ok && resolved.link.leadId === leadId && resolved.link.purpose === "book");
  const slot1 = await pickSlot(lead.propertyId);
  const visit1 = await bookVisit({ leadId, slot: slot1, source: "self-booking", actor: "visitor" });
  const afterBook = await premium.getLead(leadId);
  const pv1 = afterBook.visits.find((v) => v.id === visit1.visitId);
  check(`premium visit created and CONFIRMED (${formatIst(slot1)})`, pv1?.status === "confirmed", pv1?.status);
  check("lead stage → visit_scheduled", afterBook.stage === "visit_scheduled", afterBook.stage);
  const confirmation = await lastOut(leadId);
  check("confirmation sent in_app with a visit link", confirmation?.channel === "in_app" && /confirmed/i.test(confirmation.body) && !!linkIn(confirmation.body));
  check("nudges stopped (post-inquiry run stopped)", (await store().listRuns({ leadId })).find((r) => r.id === post?.id)?.status === "stopped");

  console.log("\n4 · One-tap reschedule via the visit link");
  const visitToken = linkIn(confirmation!.body)!;
  check("visit page opens", (await fetch(`${BASE}/b/${visitToken}`)).status === 200);
  const slot2 = await pickSlot(lead.propertyId, slot1);
  const visit2 = await rescheduleVisit(visit1.visitId, slot2, "visitor");
  const afterResched = await premium.getLead(leadId);
  check("old visit cancelled, new visit confirmed", afterResched.visits.find((v) => v.id === visit1.visitId)?.status === "cancelled" && afterResched.visits.find((v) => v.id === visit2.visitId)?.status === "confirmed");
  const preRuns = (await store().listRuns({ leadId })).filter((r) => r.sequenceId === "seq-pre-visit");
  check("reminders moved to the new visit (old run stopped, new run active)", preRuns.some((r) => r.visitId === visit1.visitId && r.status === "stopped") && preRuns.some((r) => r.visitId === visit2.visitId && r.status === "active"));

  console.log("\n5 · Pre-visit reminders (moved clock)");
  const t24 = new Date(Date.parse(slot2) - 24 * 3_600_000 + 60_000);
  check("−24 h reminder runs", (await runLeadJobs(leadId, t24)).includes("in_app:sent"));
  check("…and reached the buyer in_app with a reschedule link", /Reminder: your visit/.test((await lastOut(leadId))?.body ?? "") && !!linkIn((await lastOut(leadId))?.body ?? ""));
  const t2 = new Date(Date.parse(slot2) - 2 * 3_600_000 + 60_000);
  const at2 = await runLeadJobs(leadId, t2);
  check("−2 h: in_app sent + WhatsApp QUEUED (pending Twilio), not sent", at2.includes("in_app:sent") && at2.includes("whatsapp:pending_twilio"), at2);
  check("no WhatsApp message reached the premium thread", !(await premium.getLead(leadId)).messages.some((m) => m.channel === "whatsapp"));

  console.log("\n6 · Geotag check-in");
  const property = await premium.getProperty(lead.propertyId);
  const far = await checkIn({ visitId: visit2.visitId, by: "visitor", lat: property.coords.lat + 0.05, lng: property.coords.lng, accuracyM: 20 });
  check(`check-in ${Math.round(far.distanceM / 1000)} km away is recorded but NOT on site`, !far.onSite && (await premium.getLead(leadId)).visits.find((v) => v.id === visit2.visitId)?.status === "confirmed");
  const near = await checkIn({ visitId: visit2.visitId, by: "visitor", lat: property.coords.lat + 0.0005, lng: property.coords.lng, accuracyM: 15 });
  const afterCheck = await premium.getLead(leadId);
  check(`on-site check-in (${near.distanceM} m) → visit completed`, near.onSite && afterCheck.visits.find((v) => v.id === visit2.visitId)?.status === "completed");
  check("lead stage → visit_done", afterCheck.stage === "visit_done", afterCheck.stage);
  check("proof stored: location + time + distance", (await store().listCheckIns({ visitId: visit2.visitId })).some((c) => c.onSite && c.at && typeof c.lat === "number"));

  console.log("\n7 · Post-visit feedback → targeted next step");
  const fbMsg = await lastOut(leadId);
  const fbToken = fbMsg ? linkIn(fbMsg.body) : null;
  check("feedback form link sent in_app", !!fbToken && /How did it go/.test(fbMsg?.body ?? ""));
  const fbPage = await fetch(`${BASE}/b/${fbToken}`);
  check("feedback page opens", fbPage.status === 200 && (await fbPage.text()).includes("How do you feel about it?"));
  const fbLink = await resolveLink(fbToken!);
  const fb = await submitFeedback({ visitId: fbLink.ok ? fbLink.link.visitId! : "", leadId, interest: "maybe", objections: ["price"], rating: 4, comment: "Lovely site, a bit above budget" });
  check("feedback captured", (await store().listFeedback({ leadId })).some((f) => f.id === fb.id));
  check("objection → price nudge started", fb.actions.some((a) => a.includes("price")), fb.actions);
  const nudge = await runLeadJobs(leadId, new Date(Date.now() + 2 * 3_600_000 + 60_000 + (istParts(new Date()).hour >= 18 ? 16 * 3_600_000 : 0)));
  const nudgeMsg = await lastOut(leadId);
  check("the price nudge fired in_app", nudge.includes("in_app:sent") && /price/i.test(nudgeMsg?.body ?? ""), nudge);
  check("…grounded: quotes the real listed price", /₹/.test(nudgeMsg?.body ?? ""), nudgeMsg?.body);

  console.log("\n8 · No-show → recovery sequence");
  const lead2 = createInquiry("ashwatha-residence", "When can I visit? (batch-2 no-show test)");
  console.log(`    lead ${lead2}`);
  await waitForReply(lead2);
  const v3 = await bookVisit({ leadId: lead2, slot: await pickSlot("ashwatha-residence"), source: "rep", actor: "verify-batch2" });
  const after = new Date(Date.parse(v3.slot) + 4 * 3_600_000);
  check("no check-in 4 h after the slot → auto-marked no-show", (await detectNoShows(after)) >= 1 && (await premium.getLead(lead2)).visits.find((v) => v.id === v3.visitId)?.status === "no_show");
  check("recovery sequence started", (await store().listRuns({ leadId: lead2 })).some((r) => r.sequenceId === "seq-no-show" && r.status === "active"));
  const rec = await runLeadJobs(lead2, new Date(after.getTime() + 60 * 60_000 + (istParts(after).hour >= 19 ? 14 * 3_600_000 : 0)));
  const recMsg = await lastOut(lead2);
  check("recovery message sent in_app with a fresh booking link", rec.includes("in_app:sent") && /missed you/i.test(recMsg?.body ?? "") && !!linkIn(recMsg?.body ?? ""), rec);

  console.log(`\n${failures === 0 ? "Batch 2 flow passed" : `${failures} failed`} (${passes} passed).`);
  console.log(`Test leads left in the premium DB: ${leadId}, ${lead2}`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

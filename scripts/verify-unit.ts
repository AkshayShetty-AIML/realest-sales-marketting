/**
 * Pure rules — no network:  npm run verify
 * Grounding (facts, composer, guard), routing, Twilio signatures, phone
 * hashing, lead context, and that the contract enums are exactly the premium
 * app's (read from its source when the sibling repo is present).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFacts, type Fact } from "../lib/grounding/facts";
import { composeReply, topicsOf } from "../lib/grounding/compose";
import { guardReply } from "../lib/grounding/guard";
import { routeLead } from "../lib/automation/routing";
import { deriveContext } from "../lib/automation/context";
import { isValidTwilioSignature, twilioSignature } from "../lib/whatsapp/signature";
import { maskE164, phoneHash, toE164 } from "../lib/whatsapp/phone";
import { friendlyTwilioError, toWaStatus, windowOpen, WINDOW_MS } from "../lib/whatsapp/twilio";
import { CHANNELS, LEAD_STAGES, LEAD_STATUSES, VISIT_STATUSES, type LeadDetail, type Property } from "../lib/premium/contract";
import type { Assignment, Rep, VisitRecord } from "../lib/store/types";
import { formatIst, istParts, istToUtc, nextSendable, checkInWindowOpen } from "../lib/scheduling/time";
import { availableSlots, isBookable, DEFAULT_VISIT_SETTINGS } from "../lib/scheduling/slots";
import { distanceMeters, isOnSite } from "../lib/scheduling/geo";
import { renderTemplate, neededLinks } from "../lib/automation/templates";

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown): void {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)}`}`);
}

const base: Property = {
  id: "cedar-heights", name: "Cedar Heights", builder: "Trishul Infra", locality: "Hebbal", city: "Bengaluru",
  propertyType: "apartment", availableFor: ["buy"], salePrice: 11500000, rentPerMonth: null, priceLabel: "₹1.15 Cr",
  pricePerSqftLabel: "₹8,214/sqft", config: "2 BHK", areaSqft: 1400, possession: "under-construction", grade: "C+",
  verified: true, trust: { rera: "delayed", litigation: "some" }, gatedCommunity: true, nearMetro: false, constructionPct: 70,
  amenities: [{ kind: "gym", condition: "good" }, { kind: "swimming-pool", condition: "planned" }],
  inventory: { total: 1, available: 1, blocked: 0, sold: 0, lastVerifiedAt: "2026-09-24T00:00:00.000Z" },
  coords: { lat: 13.0358, lng: 77.597 },
};
const rentOnly: Property = { ...base, id: "ashwatha-residence", name: "Ashwatha Residence", availableFor: ["rent"], salePrice: null, rentPerMonth: 42000, priceLabel: "₹1.4 Cr" };

console.log("Fact sheet");
const facts = buildFacts(base);
const key = (fs: Fact[], k: string) => fs.find((f) => f.key === k)?.value;
check("sale price stated for a for-sale home", key(facts, "sale_price") === "₹1.15 Cr");
const rentFacts = buildFacts(rentOnly);
check("rent-only home: NO sale price fact (priceLabel is a valuation)", !key(rentFacts, "sale_price") && !rentFacts.some((f) => f.value.includes("1.4 Cr")));
check("rent stated", key(rentFacts, "rent") === "₹42,000 per month");
check("planned amenities are not claimed", key(facts, "amenities") === "gym");
check("availability carries its verified date", /1 of 1 unit available \(last verified 24 Sept? 2026\)/.test(key(facts, "availability") ?? ""), key(facts, "availability"));
check("delayed RERA stated honestly", key(facts, "rera") === "RERA-registered, currently behind schedule");

console.log("\nTemplate composer");
const visit = composeReply({ kind: "visit", message: "Can I visit this weekend? (demo lead)", contactName: "Asha D." }, facts);
check("visit: answered without inventing a slot", !visit.handoff && /team will confirm a time/.test(visit.body) && !/\d{1,2}(am|pm|:\d\d)/i.test(visit.body), visit.body);
check("greets by first name only", visit.body.startsWith("Hi Asha,"));
check("discloses it's automated", /\(automated reply\)$/.test(visit.body));
const rentQ = composeReply({ kind: "price", message: "What's the rent including maintenance? (demo lead)", contactName: null }, rentFacts);
check("rent question: rent answered, maintenance handed to a human", rentQ.body.includes("₹42,000 per month") && rentQ.humanTopics.includes("maintenance") && !rentQ.handoff, rentQ);
check("rent question never quotes a sale price", !rentQ.body.includes("Cr"));
const loan = composeReply({ kind: "general", message: "Which bank gives a loan here?", contactName: null }, facts);
check("nothing answerable → holding reply + handoff", loan.handoff && loan.humanTopics.includes("loan") && /colleague will confirm home-loan options/.test(loan.body), loan);
check("topics: rent beats price", JSON.stringify(topicsOf("price", "what's the rent")) === JSON.stringify(["rent"]));
check("every template reply passes the guard", [visit, rentQ, loan].every((d) => guardReply(d.body, d.factKeys, d === rentQ ? rentFacts : facts).ok), [visit, rentQ, loan].map((d) => guardReply(d.body, d.factKeys, d === rentQ ? rentFacts : facts).problems));

console.log("\nGrounding guard (LLM drafts)");
check("invented price rejected", !guardReply("The price is ₹1.05 Cr.", ["sale_price"], facts).ok);
check("invented unit count rejected", !guardReply("Only 3 units left!", ["availability"], facts).ok);
check("fact numbers accepted", guardReply("Cedar Heights is ₹1.15 Cr (₹8,214/sqft), 1,400 sq ft.", ["sale_price", "price_per_sqft", "area"], facts).ok);
check("unknown fact key rejected", !guardReply("Hello.", ["parking"], facts).ok);
check("no citation rejected", !guardReply("Hello.", [], facts).ok);
check("link / email / phone rejected", ["see www.x.com", "mail a@b.co", "call 98765 43210"].every((t) => !guardReply(t, ["name"], facts).ok));
check("promises rejected", !guardReply("Guaranteed returns and the best price!", ["name"], facts).ok);
check("over 500 chars rejected", !guardReply("a".repeat(501), ["name"], facts).ok);

console.log("\nRouting");
const reps: Rep[] = [
  { id: "rep-priya", name: "Priya", email: "p@x", localities: ["Hebbal", "Hennur"], active: true, clerkUserId: null },
  { id: "rep-arjun", name: "Arjun", email: "a@x", localities: ["Whitefield"], active: true, clerkUserId: null },
  { id: "rep-zed", name: "Zed", email: "z@x", localities: ["Hebbal"], active: false, clerkUserId: null },
];
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, n)).toISOString();
const held: Assignment[] = [{ id: "1", leadId: "L1", repId: "rep-priya", assignedAt: at(1), assignedBy: "x", reason: "" }];
check("locality match wins", routeLead("Hebbal", reps, [])?.rep.id === "rep-priya");
check("inactive reps never routed", routeLead("Hebbal", reps, held)?.rep.id === "rep-priya");
check("no locality match → least loaded overall", routeLead("Hennur-X", reps, held)?.rep.id === "rep-arjun");
check("a reassigned lead counts for its latest rep", routeLead("Nowhere", reps, [...held, { id: "2", leadId: "L1", repId: "rep-arjun", assignedAt: at(2), assignedBy: "x", reason: "" }])?.rep.id === "rep-priya");
check("no active reps → null", routeLead("Hebbal", reps.map((r) => ({ ...r, active: false })), []) === null);

console.log("\nWhatsApp plumbing");
const params = { Body: "Hi", From: "whatsapp:+919000000001", MessageSid: "SM1" };
const sig = twilioSignature("token", "https://x.test/api/twilio/whatsapp", params);
check("valid Twilio signature accepted", isValidTwilioSignature("token", "https://x.test/api/twilio/whatsapp", params, sig));
check("tampered body rejected", !isValidTwilioSignature("token", "https://x.test/api/twilio/whatsapp", { ...params, Body: "Hi!" }, sig));
check("wrong token / missing header rejected", !isValidTwilioSignature("nope", "https://x.test/api/twilio/whatsapp", params, sig) && !isValidTwilioSignature("token", "https://x.test/api/twilio/whatsapp", params, null));
check("E.164 normalisation", toE164("whatsapp:+91 90000 00001") === "+919000000001" && toE164("9000000001") === "+919000000001" && toE164("12") === null);
check("phone stored only as a peppered hash", phoneHash("+919000000001", "p") !== phoneHash("+919000000001", "q") && !phoneHash("+919000000001", "p").includes("9000"));
check("masked for logs", maskE164("+919000000001") === "+91 •••••••001");

console.log("\nWhatsApp rules");
const now = Date.parse("2026-10-02T12:00:00.000Z");
check("window open within 24 h of the buyer's last message", windowOpen(new Date(now - WINDOW_MS + 60_000).toISOString(), now));
check("window closed after 24 h", !windowOpen(new Date(now - WINDOW_MS - 1).toISOString(), now));
check("never messaged us → closed (template only)", !windowOpen(null, now));
check("Twilio statuses normalised", toWaStatus("accepted") === "queued" && toWaStatus("read") === "read" && toWaStatus("undelivered") === "undelivered" && toWaStatus(undefined) === "queued");
check("Twilio errors in plain language", friendlyTwilioError(63016, "x").includes("24-hour") && friendlyTwilioError("63015", "x").includes("sandbox") && friendlyTwilioError(99999, "fallback") === "fallback");

console.log("\nLead context (derived, never guessed)");
const lead: LeadDetail = {
  id: "demo-lead-2:pro-meera-rao", propertyId: "ashwatha-residence", kind: "price", message: "What's the rent including maintenance? (demo lead)",
  status: "new", stage: "inquiry", assignedTo: null, source: null, archetype: null, tags: [], buyerId: "demo-buyer-2", listerId: "pro-meera-rao",
  contact: { name: "Rohan D.", phone: "+91 •••••••002", email: "d•••@example.com", masked: true },
  createdAt: "2026-09-30T07:00:00.000Z", updatedAt: "2026-09-30T07:00:00.000Z",
  context: { property: null, nextVisit: null, messageCount: 1, lastMessageAt: null }, visits: [],
  messages: [{ id: "m1", channel: "in_app", direction: "inbound", body: "What's the rent including maintenance? (demo lead)", sentBy: "demo-buyer-2", createdAt: "2026-09-30T07:00:00.000Z", source: "in_app_thread" }],
};
const ctx = deriveContext(lead, rentOnly, Date.parse("2026-10-02T07:00:00.000Z"));
const req = (label: string) => ctx.requirements.find((r) => r.label === label)?.value;
check("intent from how the home is offered", req("Intent") === "rent (the only way this home is offered)");
check("unstated budget is 'not stated', not guessed", req("Budget") === "not stated");
check("asked-about topics", req("Asked about") === "the rent, maintenance charges", req("Asked about"));
check("person stays masked", ctx.person.masked && ctx.person.phone.includes("•"));
const stated = deriveContext({ ...lead, message: "Looking for 3 BHK under 1.5 Cr, moving next month" }, base);
check("stated requirements extracted", stated.requirements.find((r) => r.label === "Configuration")?.value === "3 BHK (stated)" && /1\.5 Cr/.test(stated.requirements.find((r) => r.label === "Budget")?.value ?? "") && /next month/.test(stated.requirements.find((r) => r.label === "Timeline")?.value ?? ""));

console.log("\nIST time + quiet hours");
const tenIst = istToUtc(2026, 9, 5, 10, 0);
check("10:00 IST = 04:30 UTC", tenIst.toISOString() === "2026-10-05T04:30:00.000Z", tenIst.toISOString());
check("IST parts round-trip", istParts(tenIst).hour === 10 && istParts(tenIst).day === 5);
check("inside 09:00–20:00 IST sends now", nextSendable(tenIst).getTime() === tenIst.getTime());
check("21:30 IST waits for 09:00 next day", nextSendable(istToUtc(2026, 9, 5, 21, 30)).toISOString() === istToUtc(2026, 9, 6, 9, 0).toISOString());
check("06:00 IST waits for 09:00 same day", nextSendable(istToUtc(2026, 9, 5, 6, 0)).toISOString() === istToUtc(2026, 9, 5, 9, 0).toISOString());
check("formatted in IST", /10:00/.test(formatIst(tenIst)));
check("check-in opens 2 h before, closes 4 h after", checkInWindowOpen(tenIst.toISOString(), tenIst.getTime() - 3_600_000) && !checkInWindowOpen(tenIst.toISOString(), tenIst.getTime() - 3 * 3_600_000) && !checkInWindowOpen(tenIst.toISOString(), tenIst.getTime() + 5 * 3_600_000));

console.log("\nVisit slots");
const monday8 = istToUtc(2026, 9, 5, 8, 0); // Mon 08:00 IST
const days = availableSlots(monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", []);
check("14 days offered", days.length === 14, days.length);
check("first day starts after the 3 h notice (11:00, not 10:00)", istParts(new Date(days[0].slots[0].start)).hour === 11, formatIst(days[0].slots[0].start));
check("hourly 10:00–17:00 slots on a full day", days[1].slots.length === 8 && istParts(new Date(days[1].slots[0].start)).hour === 10 && istParts(new Date(days[1].slots.at(-1)!.start)).hour === 17);
const slot = days[1].slots[0].start;
const rec = (id: string, status: VisitRecord["status"] = "confirmed"): VisitRecord => ({ visitId: id, leadId: id, propertyId: "cedar-heights", slot, status, source: "rep", createdAt: slot, updatedAt: slot });
check("capacity 2: one booking leaves 1", availableSlots(monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", [rec("a")])[1].slots[0].remaining === 1);
check("capacity 2: two bookings fill the slot", !isBookable(slot, monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", [rec("a"), rec("b")]));
check("cancelled visits free their slot", isBookable(slot, monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", [rec("a", "cancelled"), rec("b", "cancelled")]));
check("rescheduling may keep its own slot", isBookable(slot, monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", [rec("a"), rec("b")], "a"));
check("other properties don't count", isBookable(slot, monday8, DEFAULT_VISIT_SETTINGS, "palm-court-residency", [rec("a"), rec("b")]));
check("closed weekdays are skipped", availableSlots(monday8, { ...DEFAULT_VISIT_SETTINGS, closedWeekdays: [0] }, "x", []).every((d) => istParts(new Date(d.slots[0].start)).weekday !== 0));
check("an off-grid time is not bookable", !isBookable(new Date(Date.parse(slot) + 15 * 60_000).toISOString(), monday8, DEFAULT_VISIT_SETTINGS, "cedar-heights", []));

console.log("\nGeotag check-in");
const site = { lat: 13.0358, lng: 77.597 };
check("same spot = 0 m", distanceMeters(site, site) === 0);
check("~111 m per 0.001° latitude", Math.abs(distanceMeters(site, { lat: 13.0368, lng: 77.597 }) - 111) <= 2);
check("within 300 m is on site", isOnSite(250, 20) && !isOnSite(900, 20));
check("a huge accuracy radius can't make far away count", !isOnSite(2000, 5000));

console.log("\nTemplates");
check("variables filled", renderTemplate("Hi {{firstName}}, visit {{property}}", { firstName: "Asha", property: "Cedar Heights" }) === "Hi Asha, visit Cedar Heights");
check("fallback used when a value is missing", renderTemplate("Hi {{firstName|there}}!", {}) === "Hi there!");
check("missing value without fallback disappears cleanly", renderTemplate("Listed at {{price}}.", {}) === "Listed at.");
check("only the links a template uses are minted", JSON.stringify(neededLinks("Book: {{bookingLink}}")) === JSON.stringify({ booking: true, visit: false, feedback: false }));

console.log("\nContract enums = premium's");
const premiumSchemas = join(process.cwd(), "..", "consumer-property-app", "lib", "server", "internal", "schemas.ts");
if (existsSync(premiumSchemas)) {
  const src = readFileSync(premiumSchemas, "utf8");
  const list = (name: string) => JSON.stringify(Array.from(src.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))?.[1].matchAll(/"([a-z_]+)"/g) ?? [], (m) => m[1]));
  check("status", list("LEAD_STATUSES") === JSON.stringify(LEAD_STATUSES));
  check("stage", list("LEAD_STAGES") === JSON.stringify(LEAD_STAGES));
  check("channel", list("CHANNELS") === JSON.stringify(CHANNELS));
  check("visit", list("VISIT_STATUSES") === JSON.stringify(VISIT_STATUSES));
} else {
  console.log("  (premium repo not found beside this one — enum comparison skipped)");
}

console.log(failures === 0 ? `\nAll unit checks passed (${passes}).` : `\n${failures} failed, ${passes} passed.`);
if (failures > 0) process.exit(1);

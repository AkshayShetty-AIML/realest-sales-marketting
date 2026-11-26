/**
 * THE DESK'S S3 CHECKS — part of `npm run verify`. NOTHING here touches the
 * production database: premium's internal API is played by a LOCAL STAND-IN
 * (an HTTP server in this process implementing the S2 contract — the lead
 * cursor, POST /leads with de-duplication, the locked unit hold / release /
 * sold with their 409s, Idempotency-Key replay and the write limit's 429), and
 * the sales + harness stores are throwaway files. The desk's real code runs
 * against it, unchanged.
 *
 *  1. Lead sync: nextCursor paging while hasMore; the new-lead handler fires once per lead
 *  2. Manual leads: a duplicate shows the existing lead, nothing is created or handled again
 *  3. Allocation lock: a hold race → one wins, the other is told who holds it and until when;
 *     every refusal code in plain words; no unit status written locally
 *  4. Cost sheet: totals against known values, and identical to premium's own rules
 *  5. Proposals: versions, and nothing reaches a buyer without an approval
 *  6. Every outbound message carries its project's RERA line or exemption (AI label where AI wrote it)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = `${process.pid}-${Date.now()}`;
process.env.SALES_STORE_PATH = join(tmpdir(), `verify-desk-sales-${run}.json`);
process.env.HARNESS_STORE_PATH = join(tmpdir(), `verify-desk-harness-${run}.json`);
process.env.SALES_INTERNAL_API_KEY = "verify-desk-stand-in-key-0123456789abcdef";
process.env.GROQ_API_KEY = "";
process.env.LLM_FALLBACK_API_KEY = "";
process.env.SALES_PUBLIC_BASE_URL = "http://desk.test";

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, got?: unknown) {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || got === undefined ? "" : ` — got ${JSON.stringify(got)?.slice(0, 400)}`}`);
}
const section = (s: string) => console.log(`\n${s}`);

// ─── the premium stand-in ───────────────────────────────────────────────────

const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const prop = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, builder: "Verify Builders", locality: "Hebbal", city: "Bengaluru", propertyType: "apartment", availableFor: ["buy"], salePrice: 10_000_000, rentPerMonth: null,
  priceLabel: "₹1 Cr", pricePerSqftLabel: "", config: "3 BHK", areaSqft: 1200, possession: "under-construction", grade: "B", verified: true,
  trust: { rera: "on-time", litigation: "none" }, gatedCommunity: true, nearMetro: false, constructionPct: 40, coords: { lat: 13, lng: 77.6 },
  inventory: { total: 4, available: 4, blocked: 0, sold: 0, lastVerifiedAt: iso(NOW) },
  reraNumber: null, priceNum: 10_000_000, tco: { parking: 500_000, clubhouse: 200_000, gst: null }, tcoExtras: [], fieldStatus: {}, ...extra,
});
const PROPS: Record<string, ReturnType<typeof prop>> = {
  "p-rera": prop("p-rera", "Rera Court"),
  "p-exempt": prop("p-exempt", "Small Plot Homes"),
  "p-none": prop("p-none", "Unregistered Towers"),
  "p-listed": prop("p-listed", "Listed Heights", { reraNumber: "PRM/KA/RERA/LISTED/0009" }),
};
type U = { unitId: string; projectId: string; status: "available" | "held" | "sold"; price: number | null; floor: number; label: string; indicative: boolean; hold: { by: string | null; leadId: string | null; until: string | null; reason: string | null } | null; bookingRef: string | null; lastVerifiedAt: string; carpetSqft: number | null };
const UNITS: U[] = [
  { unitId: "u-101", projectId: "p-rera", status: "available", price: 10_000_000, floor: 1, label: "A-101", indicative: false, hold: null, bookingRef: null, lastVerifiedAt: iso(NOW - 86_400_000), carpetSqft: 1200 },
  { unitId: "u-102", projectId: "p-rera", status: "available", price: 10_000_000, floor: 1, label: "A-102", indicative: false, hold: null, bookingRef: null, lastVerifiedAt: iso(NOW - 86_400_000), carpetSqft: 1200 },
  { unitId: "u-201", projectId: "p-rera", status: "sold", price: 10_500_000, floor: 2, label: "A-201", indicative: false, hold: null, bookingRef: "BK-1", lastVerifiedAt: iso(NOW - 86_400_000), carpetSqft: 1200 },
  { unitId: "u-ph", projectId: "p-rera", status: "available", price: null, floor: 3, label: "Floor 3", indicative: true, hold: null, bookingRef: null, lastVerifiedAt: iso(NOW - 86_400_000), carpetSqft: null },
];
type L = { id: string; propertyId: string; name: string; phone: string | null; email: string | null; status: string; createdAt: string; updatedAt: string; source: string | null };
const LEADS: L[] = [];
const MESSAGES: { leadId: string; channel: string; body: string; sentBy: string; at: string }[] = [];
const WRITES: { method: string; path: string; key: string | null }[] = [];
const replay = new Map<string, { status: number; body: unknown }>();
let rateLimitNext = 0;

const leadView = (l: L) => ({
  id: l.id, propertyId: l.propertyId, kind: "general", message: "Interested in a 3 BHK", status: l.status, stage: "inquiry", assignedTo: null, source: l.source, archetype: null, tags: [],
  buyerId: `b-${l.id}`, listerId: "listing-desk", contact: { name: l.name, phone: null, email: null, masked: true }, createdAt: l.createdAt, updatedAt: l.updatedAt,
  context: { property: { id: l.propertyId, name: PROPS[l.propertyId]?.name ?? l.propertyId, builder: "Verify Builders", locality: "Hebbal", city: "Bengaluru", propertyType: "apartment", config: "3 BHK", salePrice: 10_000_000 }, nextVisit: null, messageCount: MESSAGES.filter((m) => m.leadId === l.id).length, lastMessageAt: null },
});
const detail = (l: L) => ({ ...leadView(l), visits: [], messages: MESSAGES.filter((m) => m.leadId === l.id).map((m, i) => ({ id: `m-${i}`, channel: m.channel, direction: "outbound", body: m.body, sentBy: m.sentBy, createdAt: m.at, source: "sales_app" })) });
const unitView = (u: U) => ({ unitId: u.unitId, projectId: u.projectId, status: u.status === "held" ? "blocked" : u.status, price: u.indicative ? null : u.price, lastVerifiedAt: u.lastVerifiedAt, buildingId: u.projectId, unitNo: null, label: u.label, config: u.indicative ? null : "3 BHK", floor: u.floor, facing: null, carpetSqft: u.carpetSqft, superBuiltUpSqft: null, availability: u.status, blockedUntil: u.hold?.until ?? null, indicative: u.indicative, provenance: u.indicative ? "indicative" : "owner_stated", fieldStatus: {}, hold: u.hold, bookingRef: u.bookingRef });
const cursorOf = (l: L) => `c1.${Buffer.from(JSON.stringify([l.updatedAt, l.id])).toString("base64url")}`;
const after = (cursor: string) => {
  if (cursor.startsWith("c1.")) {
    const [t, id] = JSON.parse(Buffer.from(cursor.slice(3), "base64url").toString()) as [string, string];
    return (l: L) => l.updatedAt > t || (l.updatedAt === t && l.id > id);
  }
  return (l: L) => l.updatedAt > cursor;
};
let lock = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => {
  const r = lock.then(fn);
  lock = r.then(() => undefined, () => undefined);
  return r;
};

async function handle(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  if (req.headers["x-service-key"] !== process.env.SALES_INTERNAL_API_KEY) return send(401, { error: { code: "unauthorized", message: "unauthorized" } });
  const url = new URL(req.url ?? "/", "http://stand-in");
  const p = url.pathname.replace(/^\/api\/internal/, "");
  const raw = await new Promise<string>((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });
  const body = raw ? JSON.parse(raw) : {};
  const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
  if (req.method !== "GET") {
    WRITES.push({ method: req.method!, path: p, key });
    if (rateLimitNext > 0) {
      rateLimitNext -= 1;
      return send(429, { error: { code: "rate_limited", message: "slow down" } }, { "retry-after": "1" });
    }
    if (key && replay.has(`${p}|${key}`)) {
      const r = replay.get(`${p}|${key}`)!;
      return send(r.status, r.body, { "idempotent-replayed": "true" });
    }
  }
  const ok = (data: unknown, status = 200, meta: Record<string, unknown> = {}) => {
    const out = { data, ...meta, requestId: "stand-in" };
    if (req.method === "POST" && key) replay.set(`${p}|${key}`, { status, body: out });
    return send(status, out);
  };
  const conflict = (code: string, message: string, u: U) => send(409, { error: { code, message, details: { status: unitView(u).status, availability: u.status, heldBy: u.hold?.by ?? null, leadId: u.hold?.leadId ?? null, until: u.hold?.until ?? null, bookingRef: u.bookingRef } } });
  let m: RegExpMatchArray | null;

  if (req.method === "GET" && p === "/leads") {
    const since = url.searchParams.get("since");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!since) return ok(LEADS.map(leadView));
    const rows = LEADS.filter(after(since)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)).slice(0, limit);
    return ok(rows.map(leadView), 200, { nextCursor: rows.length ? cursorOf(rows[rows.length - 1]) : since, hasMore: rows.length === limit });
  }
  if (req.method === "POST" && p === "/leads") {
    const last10 = (s: string | undefined) => (s ? s.replace(/\D/g, "").slice(-10) : null);
    const dup = LEADS.find((l) => l.propertyId === body.projectId && ((body.contact.phone && last10(l.phone ?? "") === last10(body.contact.phone)) || (body.contact.email && l.email?.toLowerCase() === body.contact.email.toLowerCase())));
    if (dup) return ok({ ...detail(dup), duplicate: true }, 200);
    const t = iso(Date.now());
    const l: L = { id: `inq-${LEADS.length + 1}`, propertyId: body.projectId, name: body.contact.name, phone: body.contact.phone ?? null, email: body.contact.email ?? null, status: "new", createdAt: t, updatedAt: t, source: body.source };
    LEADS.push(l);
    return ok({ ...detail(l), duplicate: false }, 201);
  }
  if ((m = p.match(/^\/leads\/([^/]+)$/))) {
    const l = LEADS.find((x) => x.id === decodeURIComponent(m![1]));
    if (!l) return send(404, { error: { code: "not_found", message: "lead not found" } });
    if (req.method === "PATCH") Object.assign(l, { updatedAt: iso(Date.now()) });
    return ok(detail(l));
  }
  if (req.method === "POST" && (m = p.match(/^\/leads\/([^/]+)\/messages$/))) {
    const leadId = decodeURIComponent(m[1]);
    if (body.channel === "in_app" && body.body.length > 500) return send(400, { error: { code: "invalid_request", message: "too long" } });
    MESSAGES.push({ leadId, channel: body.channel, body: body.body, sentBy: body.sentBy, at: iso(Date.now()) });
    return ok({ id: `m-${MESSAGES.length}`, channel: body.channel, direction: "outbound", body: body.body, sentBy: body.sentBy, createdAt: iso(Date.now()), source: "sales_app" }, 201);
  }
  if ((m = p.match(/^\/properties\/([^/]+)$/))) return PROPS[m[1]] ? ok(PROPS[m[1]]) : send(404, { error: { code: "not_found", message: "no" } });
  if (p === "/inventory") return ok(UNITS.filter((u) => !url.searchParams.get("projectId") || u.projectId === url.searchParams.get("projectId")).map(unitView));
  if (p === "/buildings") return ok([]);
  if (p === "/marketing/brand-kit") return ok(null);
  if (p.startsWith("/marketing/leads")) return send(404, { error: { code: "not_found", message: "no attribution" } });
  if (req.method === "POST" && (m = p.match(/^\/units\/([^/]+)\/(hold|release|sold)$/))) {
    const [, id, action] = m;
    return locked(async () => {
      const u = UNITS.find((x) => x.unitId === id);
      if (!u) return send(404, { error: { code: "not_found", message: "unit not found" } });
      await new Promise((r) => setTimeout(r, 25)); // the row lock is held while the function runs
      if (u.indicative) return conflict("unit_indicative", "placeholder", u);
      if (action === "hold") {
        if (u.status === "sold") return conflict("unit_sold", "sold", u);
        if (u.status === "held" && u.hold?.leadId !== body.leadId) return conflict("unit_held", `held by ${u.hold?.by}`, u);
        Object.assign(u, { status: "held", hold: { by: body.actor, leadId: body.leadId ?? null, until: body.expiresAt, reason: body.reason ?? null } });
      } else if (action === "release") {
        if (u.status !== "held") return conflict("unit_not_held", "not held", u);
        if (body.leadId && u.hold?.leadId !== body.leadId) return conflict("hold_lead_mismatch", "other lead", u);
        Object.assign(u, { status: "available", hold: null });
      } else {
        if (u.status === "sold") return conflict("unit_sold", "sold", u);
        if (u.status === "held" && u.hold?.leadId !== body.leadId && u.hold?.by !== body.actor) return conflict("unit_held", "held", u);
        Object.assign(u, { status: "sold", hold: null, bookingRef: body.bookingRef });
      }
      return ok(unitView(u));
    });
  }
  return send(404, { error: { code: "not_found", message: `stand-in has no ${req.method} ${p}` } });
}

async function main() {
  const server = createServer((req, res) => void handle(req, res).catch((e) => (res.writeHead(500), res.end(String(e)))));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.PREMIUM_API_BASE = `http://127.0.0.1:${port}/api/internal`;
  console.log(`Premium played by a local stand-in on :${port} — no production database is touched.`);

  const { premium, SYNC_START } = await import("../lib/premium/client");
  const { store } = await import("../lib/store");
  const { sync } = await import("../lib/automation/realtime");
  const { addManualLead, ManualLeadInput } = await import("../lib/manual-lead");
  const { holdUnit, releaseUnit, sellUnit, loadGrid } = await import("../lib/allocation");
  const { costSheet } = await import("../lib/proposals/cost-sheet");
  const { allInCost } = await import("../lib/premium/costs/all-in");
  const { generateProposal, requestProposalSend } = await import("../lib/proposals/proposals");
  const { harness } = await import("../lib/marketing/harness");
  const { gate } = await import("../lib/marketing/harness/trust");
  const { effectiveTool } = await import("../lib/marketing/harness/tools");
  const { deliver } = await import("../lib/automation/delivery");
  const { sendMessage, autoReply } = await import("../lib/automation/leads");
  const { reraLine, exemptionLine } = await import("../lib/compliance");
  const s = store();
  const exemption = { statement: "Not required to register under RERA", reason: "plot under 500 m² with 8 units or fewer", evidenceRef: "LO-2026-14" };
  await s.setProjectCompliance({ projectId: "p-rera", mode: "rera", reraRegNo: "PRM/KA/RERA/TEST/0001", exemption: null, updatedBy: "verify", updatedAt: iso(NOW) });
  await s.setProjectCompliance({ projectId: "p-exempt", mode: "exempt", reraRegNo: null, exemption, updatedBy: "verify", updatedAt: iso(NOW) });
  await s.upsertRep({ id: "rep-a", name: "Asha Rao", email: "asha@example.com", localities: [], active: true, clerkUserId: null });
  await s.upsertRep({ id: "rep-b", name: "Bilal Khan", email: "bilal@example.com", localities: [], active: true, clerkUserId: null });

  // ── 1 ──
  section("1. Lead sync: the cursor, and the new-lead handler once per lead");
  for (let i = 0; i < 450; i += 1) {
    const t = iso(NOW - 3_600_000 + Math.floor(i / 3) * 1000); // three leads share each timestamp
    LEADS.push({ id: `old-${String(i).padStart(3, "0")}`, propertyId: "p-rera", name: `Buyer ${i}`, phone: null, email: null, status: "open", createdAt: t, updatedAt: t, source: null });
  }
  const all = await premium.listAllLeads();
  check(`listAllLeads pages with nextCursor while hasMore (${all.length} of 450, tied timestamps)`, all.length === 450 && new Set(all.map((l) => l.id)).size === 450);
  const page = await premium.syncLeads(SYNC_START, 200);
  check("a full page says hasMore and hands back a cursor to pass back as received", page.hasMore && page.nextCursor.startsWith("c1."));
  await s.setCursor("premium-leads", page.nextCursor);
  await s.setCursor("lead-loop-start", iso(NOW - 60_000));
  const t1 = iso(Date.now());
  LEADS.push({ id: "new-1", propertyId: "p-rera", name: "Neha S.", phone: null, email: null, status: "new", createdAt: t1, updatedAt: t1, source: null }, { id: "new-2", propertyId: "p-none", name: "Om P.", phone: null, email: null, status: "new", createdAt: t1, updatedAt: t1, source: null });
  const handled1 = await sync("verify");
  const handled2 = await sync("verify");
  LEADS.find((l) => l.id === "new-1")!.updatedAt = iso(Date.now() + 1000);
  const handled3 = await sync("verify");
  check(`only leads created after the loop started are new; each handled once (${handled1}, then ${handled2}, then ${handled3} after an update)`, handled1 === 2 && handled2 === 0 && handled3 === 0);
  check("…the stored cursor is premium's nextCursor", ((await s.getCursor("premium-leads")) ?? "").startsWith("c1."));
  const toNew1 = MESSAGES.filter((m) => m.leadId === "new-1");
  check("the new lead got exactly one instant reply, with its project's RERA line", toNew1.length === 1 && toNew1[0].body.endsWith(reraLine("PRM/KA/RERA/TEST/0001")), toNew1.map((m) => m.body.slice(-60)));
  check("a project with no RERA number or exemption: no instant reply, the lead is handed to a rep", MESSAGES.filter((m) => m.leadId === "new-2").length === 0 && (await s.getAutoReply("new-2"))?.outcome === "handoff" && (await s.listAudit("new-2")).some((a) => a.kind === "outbound-blocked"));

  // ── 2 ──
  section("2. Manual lead entry: duplicates show the existing lead");
  const handledLeads: string[] = [];
  const onNewLead = async (lead: { id: string }) => (handledLeads.push(lead.id), { firstReply: "test" });
  const entry = ManualLeadInput.parse({ name: "Anita Rao", phone: "+91 98450 11111", email: "", projectId: "p-rera", unitId: "", source: "walk_in", notes: "Wants a corner unit", consent: true, channels: { in_app: false, email: false, whatsapp: true, sms: false } });
  const first = await addManualLead(entry, "rep-a", "add-lead:key-0001", onNewLead);
  const again = await addManualLead({ ...entry, phone: "98450 11111", name: "Anita R" }, "rep-b", "add-lead:key-0002", onNewLead);
  check("a new walk-in is created through POST /leads and goes through the new-lead handler", !first.duplicate && handledLeads.length === 1 && handledLeads[0] === first.leadId);
  check("the same phone (another format) → the EXISTING lead, nothing created, not handled again", again.duplicate && again.leadId === first.leadId && LEADS.filter((l) => l.phone?.endsWith("11111")).length === 1 && handledLeads.length === 1, again);
  check("…and the duplicate is on that lead's timeline", (await s.listAudit(first.leadId)).some((a) => a.kind === "manual-lead-duplicate"));
  check("every create carried an Idempotency-Key", WRITES.filter((w) => w.path === "/leads").every((w) => Boolean(w.key)));
  const retry = await addManualLead(entry, "rep-a", "add-lead:key-0001", onNewLead);
  check("a retried click (same key) replays the first answer — no second lead", retry.leadId === first.leadId && LEADS.filter((l) => l.phone?.endsWith("11111")).length === 1);
  check("consent must be confirmed, and a phone or an email given", !ManualLeadInput.safeParse({ ...entry, consent: false }).success && !ManualLeadInput.safeParse({ ...entry, phone: "", email: "" }).success);

  // ── 3 ──
  section("3. Allocation lock: holds, races, refusals — premium decides, nothing stored here");
  const until = iso(Date.now() + 2 * 86_400_000);
  const [ra, rb] = await Promise.all([
    holdUnit({ unitId: "u-101", leadId: "new-1", expiresAt: until, actor: "rep-a", idempotencyKey: "hold:race-a-000001" }),
    holdUnit({ unitId: "u-101", leadId: first.leadId, expiresAt: until, actor: "rep-b", idempotencyKey: "hold:race-b-000001" }),
  ]);
  const winner = ra.ok ? ra : rb;
  const loser = ra.ok ? rb : ra;
  check("two holds at once: exactly one wins", ra.ok !== rb.ok && winner.ok && winner.unit.status === "held");
  check(`the loser sees who holds it and until when ("${loser.ok ? "" : loser.message}")`, !loser.ok && loser.code === "unit_held" && loser.message.includes("Asha Rao") && /until \d{1,2} [A-Z][a-z]{2}/.test(loser.message));
  check("…the hold is on the lead's timeline; the refusal is in the audit log", (await s.listAudit("new-1")).some((a) => a.kind === "unit-held") && (await s.listAudit()).some((a) => a.kind === "unit-action-refused"));
  const sold = await holdUnit({ unitId: "u-201", leadId: "new-1", expiresAt: until, actor: "rep-a", idempotencyKey: "hold:sold-000001" });
  const notHeld = await releaseUnit({ unitId: "u-102", leadId: null, actor: "rep-a", idempotencyKey: "release:nh-000001" });
  const mismatch = await releaseUnit({ unitId: "u-101", leadId: "someone-else", actor: "rep-b", idempotencyKey: "release:mm-000001" });
  const placeholder = await holdUnit({ unitId: "u-ph", leadId: "new-1", expiresAt: until, actor: "rep-a", idempotencyKey: "hold:ph-0000001" });
  check("unit_sold / unit_not_held / hold_lead_mismatch in plain words", !sold.ok && /Already sold \(booking BK-1\)/.test(sold.message) && !notHeld.ok && /isn't held/.test(notHeld.message) && !mismatch.ok && /different lead/.test(mismatch.message), [sold, notHeld, mismatch]);
  check("a placeholder unit → \"Awaiting confirmed layout\", can't be held", !placeholder.ok && placeholder.code === "unit_indicative" && /Awaiting confirmed layout/.test(placeholder.message));
  const rel = await releaseUnit({ unitId: "u-101", leadId: "new-1", actor: "rep-a", idempotencyKey: "release:ok-000001" });
  const sale = await sellUnit({ unitId: "u-102", bookingRef: "BK-2026/0042", leadId: null, actor: "rep-a", idempotencyKey: "sold:ok-0000001" });
  check("release and mark sold go through; the release is on the lead's timeline", rel.ok && rel.unit.status === "available" && sale.ok && sale.unit.status === "sold" && (await s.listAudit("new-1")).some((a) => a.kind === "unit-released"));
  check("unit writes use /units/:id/{hold,release,sold} with an Idempotency-Key — never PATCH /inventory", WRITES.filter((w) => w.path.startsWith("/units/")).every((w) => Boolean(w.key)) && !WRITES.some((w) => w.path.startsWith("/inventory")));
  rateLimitNext = 1;
  const limited = await holdUnit({ unitId: "u-101", leadId: "new-1", expiresAt: until, actor: "rep-a", idempotencyKey: "hold:429-000001" });
  check("premium's write limit (429 + Retry-After): one wait-and-retry with the same key", limited.ok);
  const grid = await loadGrid("p-rera");
  check("the grid is premium's answer: held / sold / placeholder exactly as premium has them (blocked read as held)", grid.units.find((u) => u.unitId === "u-101")?.status === "held" && grid.units.find((u) => u.unitId === "u-102")?.status === "sold" && grid.units.find((u) => u.unitId === "u-ph")?.indicative === true);
  const salesKeys = Object.keys(JSON.parse(readFileSync(process.env.SALES_STORE_PATH!, "utf8")) as object);
  check("no unit status is written locally (the sales store has no units / inventory)", !salesKeys.some((k) => /unit|inventor|propert|building|^leads?$/i.test(k)), salesKeys);
  const code = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  check("only the verification sync calls PATCH /inventory, and it re-stamps premium's current status", (code("app/actions.ts").match(/verifyUnit\(\{/g) ?? []).length === 1 && /status: current\.status/.test(code("app/actions.ts")) && !/patchUnit/.test(code("lib/allocation.ts")) && !/store\(\)\.(upsert|set|add)/.test(code("lib/allocation.ts")));

  // ── 4 ──
  section("4. Cost sheet: known totals, and premium's own rules");
  const sheet = costSheet(PROPS["p-rera"] as never, { price: 10_000_000, carpetSqft: 1200, indicative: false });
  const line = (k: string) => (sheet.onRequest ? undefined : sheet.lines.find((l) => l.key === k)?.amount);
  check("₹1 Cr under construction: GST 5% ₹5,00,000 · stamp duty 5% ₹5,00,000 · cess+surcharge ₹60,000 · registration 2% ₹2,00,000", line("gst") === 500_000 && line("stampDuty") === 500_000 && line("stampCess") === 60_000 && line("registration") === 200_000);
  check("…+ parking ₹5,00,000 + clubhouse ₹2,00,000 → all-in ₹1,19,60,000", !sheet.onRequest && sheet.total === 11_960_000, sheet.onRequest ? sheet : sheet.total);
  check("…floor rise, legal, maintenance deposit, corpus: \"developer to confirm\", left out of the total", !sheet.onRequest && ["Floor rise", "Legal & documentation", "Maintenance deposit", "Corpus fund"].every((x) => sheet.toConfirm.includes(x)) && line("floorRise") === null);
  const aff = costSheet({ ...PROPS["p-rera"], tco: { parking: null, clubhouse: null, gst: null } } as never, { price: 4_000_000, carpetSqft: 600, indicative: false });
  check("₹40 L, 600 sq ft (affordable): GST 1% ₹40,000 · stamp 3% ₹1,20,000 · cess ₹14,400 · registration ₹80,000 → ₹42,54,400", !aff.onRequest && aff.total === 4_254_400, aff.onRequest ? aff : aff.total);
  const ready = costSheet({ ...PROPS["p-rera"], possession: "ready" } as never, { price: 10_000_000, carpetSqft: 1200, indicative: false });
  check("ready to move: GST is \"developer to confirm\" (nil only with the certificate); one payment plan", !ready.onRequest && ready.lines.find((l) => l.key === "gst")?.amount === null && ready.plans.length === 1 && ready.plans[0].id === "ready");
  check("construction-linked plan: instalments add up to 100% and to the price", !sheet.onRequest && Math.round(sheet.plans[0].instalments.reduce((n, i) => n + i.pct, 0)) === 100 && Math.abs(sheet.plans[0].instalments.reduce((n, i) => n + i.amount, 0) - 10_000_000) <= 10);
  check("a placeholder unit or no price → on request, never a figure", costSheet(PROPS["p-rera"] as never, { price: null, carpetSqft: null, indicative: true }).onRequest);
  const premiumAllIn = join(process.cwd(), "..", "consumer-property-app", "lib", "costs", "all-in.ts");
  if (existsSync(premiumAllIn)) {
    const theirs = (await import(premiumAllIn)) as { allInCost: typeof allInCost };
    const cases = [{ p: PROPS["p-rera"], price: 10_000_000, carpet: 1200 }, { p: { ...PROPS["p-rera"], tco: { parking: null, clubhouse: null, gst: null } }, price: 4_000_000, carpet: 600 }, { p: { ...PROPS["p-rera"], possession: "ready", tcoExtras: [{ label: "Floor rise charges", amount: 150_000 }, { label: "Legal fee", amount: 25_000 }] }, price: 25_000_000, carpet: 2000 }];
    const same = cases.every((c) => JSON.stringify(theirs.allInCost(c.p as never, { price: c.price, carpetSqft: c.carpet })) === JSON.stringify(allInCost(c.p as never, { price: c.price, carpetSqft: c.carpet })));
    check("identical to premium's own allInCost (run from its source) on every case", same);
    for (const f of [["lib/costs/rates.ts", "lib/premium/costs/rates.ts"], ["lib/calculators/payment-plan.ts", "lib/premium/costs/payment-plan.ts"]]) {
      const theirsSrc = readFileSync(join(process.cwd(), "..", "consumer-property-app", f[0]), "utf8");
      check(`${f[1]} is premium's ${f[0]} verbatim`, code(f[1]).endsWith(theirsSrc));
    }
  } else console.log("  (premium repo not found beside this one — comparison with its cost rules skipped)");

  // ── 5 ──
  section("5. Proposals: versions, and nothing sent without an approval");
  const h = harness();
  const ws = await h.createWorkspace({ name: "Verify Builders", members: ["rep-a"], builderId: "Verify Builders", actor: "verify", enabled: true, autonomy: "autonomous-within-guardrails" });
  const v1 = await generateProposal("new-1", "u-101", "rep-a", h);
  const same = await generateProposal("new-1", "u-101", "rep-a", h);
  UNITS.find((u) => u.unitId === "u-101")!.price = 10_200_000;
  const v2 = await generateProposal("new-1", "u-101", "rep-a", h);
  check("version 1, the same again when nothing changed, version 2 when the price changed — both kept", v1.isNew && v1.proposal.version === 1 && !same.isNew && same.proposal.id === v1.proposal.id && v2.isNew && v2.proposal.version === 2 && (await s.listProposals({ leadId: "new-1" })).length === 2);
  const c2 = v2.proposal.content as { complianceLine: string; sheet: { onRequest: boolean } };
  check("the proposal carries the project's RERA line", c2.complianceLine === reraLine("PRM/KA/RERA/TEST/0001"));
  const before = MESSAGES.filter((m) => m.leadId === "new-1").length;
  const pending = await requestProposalSend(v2.proposal.id, "rep-a", h);
  const approval = (await h.approvals(ws.id, "pending")).find((a) => a.tool === "proposal.send");
  check("sending asks for an approval — nothing reaches the buyer yet", pending.send.status === "awaiting_approval" && Boolean(approval) && MESSAGES.filter((m) => m.leadId === "new-1").length === before);
  const eff = (await effectiveTool(h.store.scope(ws.id), "proposal.send"))!;
  check("proposal.send is outbound and approval-gated at EVERY autonomy level", ["autonomous-within-guardrails", "approve-each", "suggest-only"].every((a) => gate({ workspace: { enabled: true, autonomy: a as never }, tool: eff, scopes: ["outbound:send"], tainted: false }).kind === "approval") && eff.tool.requiresApproval);
  const forged = await eff.tool.handler(approval!.args as never, { workspaceId: ws.id, workspace: { id: ws.id, builderId: ws.builderId, autonomy: ws.autonomy, projects: [] }, goalId: null, taskId: null, runId: null, actor: "rep-a", now: iso(Date.now()), memory: h.memory(ws.id), approvalId: "apr_not-this-one" } as never).then(() => "sent", (e: Error) => e.message);
  check("calling the send with any other approval id is refused — nothing sent", /doesn't match/.test(forged) && MESSAGES.filter((m) => m.leadId === "new-1").length === before);
  await h.decide(ws.id, approval!.id, "approve", "operator:rep-a", null);
  await h.settled();
  const sentNow = MESSAGES.filter((m) => m.leadId === "new-1").slice(before);
  check("approved → delivered in-app once, with the share link and the RERA line", sentNow.length === 1 && /http:\/\/desk\.test\/b\//.test(sentNow[0].body) && sentNow[0].body.endsWith(reraLine("PRM/KA/RERA/TEST/0001")) && (await s.getProposal(v2.proposal.id))?.send.status === "sent", sentNow.map((m) => m.body));
  const noWs = await generateProposal(first.leadId, "u-101", "rep-a", h).then(async (r) => { await h.updateWorkspace(ws.id, { builderId: null }, "verify"); return requestProposalSend(r.proposal.id, "rep-a", h).then(() => "sent", (e: Error) => e.message); });
  check("no workspace to approve it → it can't be sent, and the rep is told why", /No marketing workspace approves/.test(noWs), noWs);
  const exemptLead = { id: "lead-ex", propertyId: "p-exempt", name: "Ex", phone: null, email: null, status: "open", createdAt: iso(NOW), updatedAt: iso(NOW), source: null };
  LEADS.push(exemptLead);
  UNITS.push({ unitId: "u-ex", projectId: "p-exempt", status: "available", price: 6_000_000, floor: 1, label: "1", indicative: false, hold: null, bookingRef: null, lastVerifiedAt: iso(NOW), carpetSqft: 900 });
  check("an exempt project's proposal carries its exemption statement", ((await generateProposal("lead-ex", "u-ex", "rep-a", h)).proposal.content as { complianceLine: string }).complianceLine === exemptionLine(exemption));
  const noneLead = { ...exemptLead, id: "lead-none", propertyId: "p-none" };
  LEADS.push(noneLead);
  UNITS.push({ unitId: "u-none", projectId: "p-none", status: "available", price: 6_000_000, floor: 1, label: "1", indicative: false, hold: null, bookingRef: null, lastVerifiedAt: iso(NOW), carpetSqft: 900 });
  check("…with neither, no proposal can be made", /no RERA registration number or exemption/.test(await generateProposal("lead-none", "u-none", "rep-a", h).then(() => "made", (e: Error) => e.message)));

  // ── 6 ──
  section("6. Every outbound message: its RERA line or exemption, and an AI label where AI wrote it");
  LEADS.push({ ...exemptLead, id: "lead-listed", propertyId: "p-listed" });
  const n0 = MESSAGES.length;
  const d1 = await deliver("new-1", "in_app", "Your visit is confirmed for Saturday.", "visit-confirmation");
  const d2 = await deliver("lead-ex", "in_app", "Here is the brochure.", "brochure:rep-a");
  const d3 = await deliver("lead-none", "in_app", "Hello!", "sequence:test");
  const d4 = await deliver("lead-listed", "in_app", "Hello!", "sequence:test");
  const posted = MESSAGES.slice(n0);
  check("a RERA project: the message ends with its RERA line", d1.status === "sent" && posted[0]?.body.endsWith(reraLine("PRM/KA/RERA/TEST/0001")));
  check("an exempt project: the message ends with its exemption statement, reason and reference", d2.status === "sent" && posted[1]?.body.endsWith(exemptionLine(exemption)));
  check("neither: NOT sent (failed, nothing posted), and audited", d3.status === "failed" && posted.length === 3 && (await s.listAudit("lead-none")).some((a) => a.kind === "outbound-blocked"));
  check("no setting but premium has the project's RERA number → that line", d4.status === "sent" && posted[2]?.body.endsWith(reraLine("PRM/KA/RERA/LISTED/0009")));
  const q = await deliver("new-1", "whatsapp", "Reminder: visit tomorrow.", "sequence:test");
  check("queued channels (WhatsApp pending) keep the line too — what waits is what will go", q.status === "pending_twilio" && Boolean(q.body?.endsWith(reraLine("PRM/KA/RERA/TEST/0001"))));
  await sendMessage("new-1", "in_app", "Happy to help — the sample flat is open on Sunday.", "rep-a");
  await sendMessage("new-1", "in_app", "The clubhouse has a gym and a pool.", "ai-auto-reply", { ai: true });
  const [rep, ai] = MESSAGES.slice(-2);
  check("a rep's message carries the line, and no AI label", rep.body.endsWith(reraLine("PRM/KA/RERA/TEST/0001")) && !/\bAI\b/.test(rep.body));
  check("an AI-written message carries the AI label and the line", ai.body.includes("AI-assisted reply") && ai.body.endsWith(reraLine("PRM/KA/RERA/TEST/0001")));
  check("a rep message on a project with neither is refused", /Not sent: this project has no RERA/.test(await sendMessage("lead-none", "in_app", "Hi", "rep-a").then(() => "sent", (e: Error) => e.message)));
  const t2 = iso(Date.now());
  LEADS.push({ id: "new-ex", propertyId: "p-exempt", name: "Ira M.", phone: null, email: null, status: "new", createdAt: t2, updatedAt: t2, source: null });
  const ar = await autoReply("new-ex", "verify");
  check("the instant reply (automatic first replies off) carries the exemption line", ar.done && MESSAGES.filter((m) => m.leadId === "new-ex").at(-1)!.body.endsWith(exemptionLine(exemption)));
  check("every message the desk posted in this run ends with a RERA line or an exemption", MESSAGES.every((m) => /RERA( Reg\. No\.)?: .+$/.test(m.body)), MESSAGES.filter((m) => !/RERA( Reg\. No\.)?: .+$/.test(m.body)).map((m) => m.body.slice(0, 80)));

  server.close();
  for (const f of [process.env.SALES_STORE_PATH!, process.env.HARNESS_STORE_PATH!]) rmSync(f, { force: true });
  console.log(failures === 0 ? `\n✓ desk checks passed (${passes})` : `\n✗ desk checks: ${failures} failed, ${passes} passed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

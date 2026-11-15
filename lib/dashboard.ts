import "server-only";
import { premium, PremiumError } from "./premium/client";
import { LEAD_STAGES, type Lead, type LeadStage } from "./premium/contract";
import { store } from "./store";
import { scoreLeads, type ScoredLead } from "./scoring/load";
import type { Band } from "./scoring/model";
import { loadInventory, type InventoryRow } from "./inventory";

/**
 * THE COMMAND CENTRE's numbers. Everything is computed from live premium data
 * (leads, their threads and visits, inventory) + this desk's state, at request
 * time. Definitions are stated next to each number so the dashboard can say
 * exactly what it shows.
 */

const MIN = 60_000;

export interface Dashboard {
  generatedAt: string;
  error: string | null;
  /** Leads whose detail couldn't be read (rate limit / network) — their thread & visit numbers are missing. */
  partial: number;
  leads: { total: number; open: number; won: number; lost: number };
  /** Open leads by CURRENT contract stage. */
  pipeline: { stage: LeadStage; count: number }[];
  scores: Record<Band, number>;
  hottest: { id: string; name: string; property: string; score: number; band: Band; reason: string | null }[];
  /** First response = first outbound message (any sender) minus the inquiry time. */
  response: { buckets: { label: string; count: number }[]; answered: number; waiting: number; medianMin: number | null; p90Min: number | null; aiShare: number | null };
  /** From premium visits (the source of truth). */
  visits: { booked: number; upcoming: number; completed: number; noShow: number; cancelled: number; noShowRate: number | null; checkedInOnSite: number };
  /** Leads that REACHED each step (current stage, or later evidence such as a visit). */
  funnel: { label: string; count: number }[];
  /** Next booked visits (premium visits, soonest first). */
  upcoming: { visitId: string; leadId: string; slot: string; property: string; buyer: string; bookedBy: "buyer" | "rep" }[];
  /** Recent desk events a rep cares about, in plain words (from the audit log). */
  activity: { id: string; at: string; leadId: string | null; tone: "good" | "caution" | "risk"; title: string; detail: string }[];
  inventory: { rows: InventoryRow[]; available: number; blocked: number; sold: number; fresh: number; ageing: number; stale: number; oldest: string | null; error: string | null };
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

const stageIndex = (s: LeadStage) => LEAD_STAGES.indexOf(s);

export async function loadDashboard(now = Date.now()): Promise<Dashboard> {
  let leads: Lead[] = [];
  let error: string | null = null;
  try {
    leads = await premium.listLeads({ limit: 200 });
  } catch (e) {
    error = e instanceof PremiumError ? e.message : "Could not load leads from the premium app.";
  }
  const [scored, inventory, checkIns, records, audit] = await Promise.all([
    leads.length ? scoreLeads(leads, now) : Promise.resolve(new Map<string, ScoredLead>()),
    loadInventory(now).then((rows) => ({ rows, error: null as string | null })).catch((e) => ({ rows: [] as InventoryRow[], error: e instanceof Error ? e.message : "inventory unavailable" })),
    store().listCheckIns(),
    store().listVisits(),
    store().listAudit(undefined, 120),
  ]);
  const all = [...scored.values()];
  const open = leads.filter((l) => l.status !== "won" && l.status !== "lost");

  // ── Scores ──
  const scores: Record<Band, number> = { hot: 0, warm: 0, cold: 0, closed: 0 };
  for (const s of all) scores[s.score.band] += 1;
  const hottest = all
    .filter((s) => s.score.band !== "closed")
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 5)
    .map((s) => ({ id: s.lead.id, name: s.lead.contact.name ?? "Buyer", property: s.lead.context.property?.name ?? s.lead.propertyId, score: s.score.score, band: s.score.band, reason: s.score.top[0]?.label ?? null }));

  // ── Response times ──
  const times: number[] = [];
  let ai = 0;
  let waiting = 0;
  for (const s of all) {
    if (!s.detail) continue;
    const first = s.detail.messages.find((m) => m.direction === "outbound");
    if (!first) {
      waiting += 1;
      continue;
    }
    times.push(Math.max(0, (Date.parse(first.createdAt) - Date.parse(s.lead.createdAt)) / MIN));
    if (first.sentBy === "ai-auto-reply") ai += 1;
  }
  times.sort((a, b) => a - b);
  const bucket = (lo: number, hi: number) => times.filter((t) => t >= lo && t < hi).length;
  const response = {
    buckets: [
      { label: "Under 5 min", count: bucket(0, 5) },
      { label: "5–60 min", count: bucket(5, 60) },
      { label: "1–24 hours", count: bucket(60, 1440) },
      { label: "Over a day", count: bucket(1440, Infinity) },
      { label: "No reply yet", count: waiting },
    ],
    answered: times.length,
    waiting,
    medianMin: quantile(times, 0.5),
    p90Min: quantile(times, 0.9),
    aiShare: times.length ? ai / times.length : null,
  };

  // ── Visits (premium is the truth) ──
  const visits = all.flatMap((s) => s.detail?.visits ?? []);
  const completed = visits.filter((v) => v.status === "completed").length;
  const noShow = visits.filter((v) => v.status === "no_show").length;
  const visitIds = new Set(visits.map((v) => v.id));

  // ── Funnel: reached each step ──
  const reached = (s: ScoredLead, step: LeadStage) => {
    const visitsOf = s.detail?.visits ?? [];
    let idx = stageIndex(s.lead.stage);
    if (visitsOf.length) idx = Math.max(idx, stageIndex("visit_scheduled"));
    if (visitsOf.some((v) => v.status === "completed")) idx = Math.max(idx, stageIndex("visit_done"));
    if (s.lead.status === "won") idx = LEAD_STAGES.length - 1;
    return idx >= stageIndex(step);
  };
  const funnel = [
    { label: "Inquiry", count: all.length },
    { label: "Replied to", count: response.answered },
    { label: "Qualified", count: all.filter((s) => reached(s, "qualified")).length },
    { label: "Visit booked", count: all.filter((s) => reached(s, "visit_scheduled")).length },
    { label: "Visited", count: all.filter((s) => reached(s, "visit_done")).length },
    { label: "Negotiation", count: all.filter((s) => reached(s, "negotiation")).length },
    { label: "Booking", count: all.filter((s) => reached(s, "booking")).length },
    { label: "Won", count: leads.filter((l) => l.status === "won").length },
  ];

  // ── Inventory ──
  const inv = inventory.rows;
  const oldest = inv.reduce<string | null>((o, u) => (!o || u.lastVerifiedAt < o ? u.lastVerifiedAt : o), null);

  // ── Upcoming visits + recent activity (presentation of existing data) ──
  const source = new Map(records.map((r) => [r.visitId, r.source]));
  const upcoming = all
    .flatMap((s) => (s.detail?.visits ?? []).map((v) => ({ v, s })))
    .filter(({ v }) => (v.status === "scheduled" || v.status === "confirmed") && Date.parse(v.slot) >= now - 3_600_000)
    .sort((a, b) => a.v.slot.localeCompare(b.v.slot))
    .map(({ v, s }) => ({
      visitId: v.id,
      leadId: s.lead.id,
      slot: v.slot,
      property: s.lead.context.property?.name ?? s.lead.propertyId,
      buyer: s.lead.contact.name ?? "Buyer",
      bookedBy: (source.get(v.id) === "rep" ? "rep" : "buyer") as "buyer" | "rep",
    }));
  const leadName = new Map(all.map((s) => [s.lead.id, { buyer: s.lead.contact.name ?? "Buyer", property: s.lead.context.property?.name ?? s.lead.propertyId }]));
  const ACTIVITY: Record<string, { tone: "good" | "caution" | "risk"; title: (who: string) => string }> = {
    inbound: { tone: "caution", title: (who) => `${who} replied` },
    "visit-booked": { tone: "good", title: () => "Site visit confirmed" },
    "visit-completed": { tone: "good", title: () => "Visit done" },
    "visit-no-show": { tone: "risk", title: () => "No-show marked" },
    "visit-cancelled": { tone: "risk", title: () => "Visit cancelled" },
    feedback: { tone: "good", title: (who) => `${who} sent feedback` },
    "needs-rep": { tone: "caution", title: (who) => `${who} needs a rep` },
    "brochure-sent": { tone: "good", title: (who) => `Brochure sent to ${who}` },
  };
  const activity = audit
    .filter((e) => ACTIVITY[e.kind])
    .sort((a, b) => b.at.localeCompare(a.at))
    // one line per lead + kind (the latest), so repeats don't crowd the list
    .filter((e, i, list) => list.findIndex((x) => x.kind === e.kind && x.leadId === e.leadId) === i)
    .slice(0, 6)
    .map((e) => {
      const who = e.leadId ? leadName.get(e.leadId) : undefined;
      return { id: e.id, at: e.at, leadId: e.leadId, tone: ACTIVITY[e.kind].tone, title: ACTIVITY[e.kind].title(who?.buyer ?? "A buyer"), detail: who?.property ?? "" };
    });

  return {
    upcoming,
    activity,
    generatedAt: new Date(now).toISOString(),
    error,
    partial: all.filter((s) => !s.complete).length,
    leads: { total: leads.length, open: open.length, won: leads.filter((l) => l.status === "won").length, lost: leads.filter((l) => l.status === "lost").length },
    pipeline: LEAD_STAGES.map((stage) => ({ stage, count: open.filter((l) => l.stage === stage).length })),
    scores,
    hottest,
    response,
    visits: {
      booked: visits.length,
      upcoming: visits.filter((v) => v.status === "scheduled" || v.status === "confirmed").length,
      completed,
      noShow,
      cancelled: visits.filter((v) => v.status === "cancelled").length,
      noShowRate: completed + noShow ? noShow / (completed + noShow) : null,
      checkedInOnSite: checkIns.filter((c) => c.onSite && visitIds.has(c.visitId)).length,
    },
    funnel,
    inventory: {
      rows: inv,
      available: inv.filter((u) => u.status === "available").length,
      blocked: inv.filter((u) => u.status === "blocked").length,
      sold: inv.filter((u) => u.status === "sold").length,
      fresh: inv.filter((u) => u.freshness === "fresh").length,
      ageing: inv.filter((u) => u.freshness === "ageing").length,
      stale: inv.filter((u) => u.freshness === "stale").length,
      oldest,
      error: inventory.error,
    },
  };
}

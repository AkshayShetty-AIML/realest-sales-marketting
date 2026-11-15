import type { LeadDetail, Property } from "../premium/contract";
import type { CheckIn, Feedback, OptIn, VisitRecord } from "../store/types";

/**
 * LEAD SCORING — DETERMINISTIC model behind a seam. Pure.
 *
 * Score 0–100 from four families of evidence, each a list of signed
 * contributions so the "why" is exact (the top reasons are just the largest
 * |points|). Bands: hot ≥ 60 · warm ≥ 35 · cold below. Closed leads (won/lost)
 * are banded "closed" and sink to the bottom of the priority list.
 *
 *   behaviour   what the buyer DID in-app: messages, replies, visits, check-in, feedback, consent
 *   fit         stated requirements vs the property's real facts (config, budget)
 *   engagement  how specific the inquiry was
 *   recency     how recently the buyer acted
 *
 * SEAM: `ScoringModel` — swap `deterministicModel` for a trained model (same
 * input, same output shape) via `scoringModel()`; nothing else changes.
 * Junk / duplicate detection is deferred until external lead sources exist.
 */

export type Band = "hot" | "warm" | "cold" | "closed";

export interface Reason {
  family: "behaviour" | "fit" | "engagement" | "recency";
  label: string;
  points: number;
}

export interface LeadScore {
  score: number;
  band: Band;
  reasons: Reason[];
  /** The 3 biggest contributions, for the inbox. */
  top: Reason[];
  model: string;
}

export interface ScoringInput {
  lead: LeadDetail;
  property: Property | null;
  visits: VisitRecord[];
  checkIns: CheckIn[];
  feedback: Feedback[];
  optIn: OptIn | null;
  /** Defaults to the current time. */
  now?: number;
}

export interface ScoringModel {
  id: string;
  score(input: ScoringInput): LeadScore;
}

const BASE = 20;
const HOUR = 3_600_000;

function parseBudget(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(cr|crore|crores|lakh|lakhs|lac|l)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^(cr|crore|crores)$/i.test(m[2]) ? n * 1e7 : n * 1e5;
}

export const deterministicModel: ScoringModel = {
  id: "deterministic-v1",
  score({ lead, property, visits, checkIns, feedback, optIn, now = Date.now() }) {
    const reasons: Reason[] = [];
    const add = (family: Reason["family"], label: string, points: number) => points !== 0 && reasons.push({ family, label, points });

    // ── behaviour ──
    const inbound = lead.messages.filter((m) => m.direction === "inbound");
    const extra = Math.max(0, inbound.length - 1); // the first inbound is usually the inquiry itself
    if (extra > 0) add("behaviour", `${extra} follow-up message${extra === 1 ? "" : "s"} from the buyer`, Math.min(18, extra * 6));
    const firstOut = lead.messages.find((m) => m.direction === "outbound");
    if (firstOut && inbound.some((m) => m.createdAt > firstOut.createdAt)) add("behaviour", "replied to us", 10);
    const active = visits.filter((v) => v.status === "scheduled" || v.status === "confirmed");
    const done = visits.filter((v) => v.status === "completed");
    const noShows = visits.filter((v) => v.status === "no_show");
    if (active.length) add("behaviour", "visit booked", 20);
    if (done.length) add("behaviour", "visited the site", 15);
    if (checkIns.some((c) => c.onSite)) add("behaviour", "checked in on site", 5);
    if (noShows.length) add("behaviour", `missed ${noShows.length === 1 ? "a visit" : `${noShows.length} visits`}`, -10 * Math.min(2, noShows.length));
    const fb = feedback.at(-1);
    if (fb?.interest === "interested") add("behaviour", "said they're interested after the visit", 20);
    if (fb?.interest === "maybe") add("behaviour", `undecided after the visit${fb.objections.length ? ` (${fb.objections.join(", ")})` : ""}`, 5);
    if (fb?.interest === "not_interested") add("behaviour", "said it's not for them", -25);
    if (optIn?.status === "opted_in") add("behaviour", "opted in to WhatsApp", 5);
    if (optIn?.status === "opted_out") add("behaviour", "opted out of WhatsApp", -5);

    // ── fit (stated requirements vs real facts) ──
    const text = [lead.message, ...inbound.map((m) => m.body)].join(" ");
    const bhk = text.match(/\b([1-6])\s*-?\s*bhk\b/i)?.[1];
    const homeBhk = property?.config?.match(/(\d)/)?.[1];
    if (bhk && homeBhk) add("fit", bhk === homeBhk ? `wants ${bhk} BHK — this home is ${homeBhk} BHK` : `wants ${bhk} BHK, this home is ${homeBhk} BHK`, bhk === homeBhk ? 10 : -6);
    const budget = parseBudget(text);
    const price = property?.salePrice ?? null;
    if (budget && price) {
      const ratio = price / budget;
      add("fit", ratio <= 1 ? "within their stated budget" : ratio <= 1.15 ? "slightly above their stated budget" : "well above their stated budget", ratio <= 1 ? 10 : ratio <= 1.15 ? 0 : -10);
    }

    // ── engagement ──
    const KIND: Record<string, number> = { visit: 10, callback: 8, price: 6, availability: 5, general: 2 };
    add("engagement", `${lead.kind} inquiry`, KIND[lead.kind] ?? 0);

    // ── recency ──
    const lastBuyer = Math.max(Date.parse(lead.createdAt), ...inbound.map((m) => Date.parse(m.createdAt)), ...checkIns.map((c) => Date.parse(c.at)), ...feedback.map((f) => Date.parse(f.at)));
    const age = now - lastBuyer;
    if (age < 24 * HOUR) add("recency", "active in the last 24 h", 15);
    else if (age < 72 * HOUR) add("recency", "active in the last 3 days", 8);
    else if (age < 7 * 24 * HOUR) add("recency", "active this week", 3);
    else if (age > 14 * 24 * HOUR) add("recency", `quiet for ${Math.round(age / (24 * HOUR))} days`, -10);

    const score = Math.max(0, Math.min(100, BASE + reasons.reduce((s, r) => s + r.points, 0)));
    const closed = lead.status === "won" || lead.status === "lost";
    const band: Band = closed ? "closed" : score >= 60 ? "hot" : score >= 35 ? "warm" : "cold";
    const top = [...reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
    return { score, band, reasons, top, model: this.id };
  },
};

/** SEAM: the active model. */
export function scoringModel(): ScoringModel {
  return deterministicModel;
}

const BAND_RANK: Record<Band, number> = { hot: 0, warm: 1, cold: 2, closed: 3 };

/** Priority order: band, then score, then most recent. */
export function byPriority<T extends { score: LeadScore; updatedAt: string }>(a: T, b: T): number {
  return BAND_RANK[a.score.band] - BAND_RANK[b.score.band] || b.score.score - a.score.score || b.updatedAt.localeCompare(a.updatedAt);
}

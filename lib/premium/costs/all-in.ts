/**
 * MIRRORED VERBATIM from the premium app (consumer-property-app/lib/costs/all-in.ts) —
 * the same cost rules, so a proposal shows the figures the buyer sees on the
 * listing. Only the import lines differ. `npm run verify` runs premium's own
 * functions on the same inputs and fails if any figure differs. Change the
 * rule in premium, then copy it here.
 */
import type { Property } from "./types";
import { fieldState } from "./types";
import { RATES, rateLabel, rateNote } from "./rates";

/**
 * "WHAT YOU'LL ACTUALLY PAY" (PRM-21) — the one all-in cost for a home: the
 * base price, each builder charge from the listing's cost sheet (via the
 * pipeline), and the government charges COMPUTED from lib/costs/rates.ts
 * (GST, Karnataka stamp duty + cess + surcharge, registration). Every line says
 * where it comes from; a line nobody has stated yet is "Being verified" and is
 * left out of the total (never guessed). Illustrative — confirm with the builder.
 *
 * The cost sheet's own stamp-duty / registration / cess estimates are NOT
 * used: those are computed from the rates, so nothing is counted twice.
 * Pure — the same numbers on the server, in the browser and in the calculators.
 */

export type CostProvenance = "builder" | "computed" | "estimate";

export interface CostLine {
  key: string;
  label: string;
  /** null = being verified (not on the cost sheet yet) — excluded from the total. */
  amount: number | null;
  provenance: CostProvenance | null;
  source: string;
  /** The full citation behind `source`, when it is a rate. */
  sourceDetail?: string;
  note?: string;
}

export type AllInCost =
  | { onRequest: true }
  | { onRequest: false; lines: CostLine[]; total: number; pending: string[]; base: number };

/** Stamp duty for an agreement value (Karnataka slabs), and the cess + surcharge on it. */
export function stampDuty(value: number): { duty: number; cessAndSurcharge: number; pct: number } {
  const sd = RATES.karnataka.stampDuty;
  const slab = sd.slabs.find((s) => s.upTo === null || value <= s.upTo)!;
  const duty = Math.round((value * slab.pct) / 100);
  return { duty, cessAndSurcharge: Math.round((duty * (sd.cessPctOfDuty + sd.surchargePctOfDuty)) / 100), pct: slab.pct };
}

export const registrationFee = (value: number) => Math.round((value * RATES.karnataka.registration.pct) / 100);

/** GST % for this home under the configured rules, with why. */
export function gstFor(property: Pick<Property, "possession" | "propertyType">, value: number, carpetSqft: number | null): { pct: number | null; why: string } {
  const g = RATES.gst;
  if (property.propertyType === "plot") return { pct: 0, why: "No GST on the sale of land." };
  if (property.possession === "ready") {
    return { pct: null, why: "Ready to move: GST is nil once the completion / occupancy certificate is issued — confirm it has been." };
  }
  const carpetSqm = carpetSqft === null ? null : carpetSqft / 10.764;
  const affordable = value <= g.affordableMaxPrice && carpetSqm !== null && carpetSqm <= g.affordableMaxCarpetSqmMetro;
  return { pct: affordable ? g.affordablePct : g.underConstructionPct, why: affordable ? `Affordable housing (≤ ₹45 L and ≤ ${g.affordableMaxCarpetSqmMetro} m² carpet): ${g.affordablePct}%.` : `Under construction: ${g.underConstructionPct}% of the agreement value, without input tax credit.` };
}

const SHEET_SKIP = /stamp|registration|cess|surcharge|\bgst\b/i;
const SHEET_LINE: { key: string; label: string; match: RegExp }[] = [
  { key: "legal", label: "Legal & documentation", match: /legal|khata|katha|documentation/i },
  { key: "maintenanceDeposit", label: "Maintenance deposit", match: /maintenance (deposit|advance)|advance maintenance/i },
  { key: "corpus", label: "Corpus fund", match: /corpus/i },
];

/**
 * The all-in cost for a home at `price`. `indicative` (a layout placeholder):
 * "On request" — never figures invented around a price nobody stated.
 */
export function allInCost(property: Property, opts: { price: number | null; indicative?: boolean; carpetSqft?: number | null }): AllInCost {
  if (opts.indicative || opts.price === null) return { onRequest: true };
  const base = opts.price;
  const sheetSource = (key: string) => fieldState(property, key).source ?? "the developer's cost sheet";
  const sheetProvenance = (key: string): CostProvenance => {
    const s = fieldState(property, key).status;
    return s === "estimate" || s === "assumed" || s === "to_confirm" ? "estimate" : "builder";
  };
  const lines: CostLine[] = [];

  lines.push({ key: "base", label: "Base price", amount: base, provenance: "builder", source: fieldState(property, "priceNum").source ?? "the developer" });

  // ── Builder charges from the cost sheet (parking, clubhouse, and named extras) ──
  const t = property.tco;
  if (t.parking !== null) lines.push({ key: "parking", label: "Car parking", amount: t.parking, provenance: sheetProvenance("tco.parking"), source: sheetSource("tco.parking"), note: t.parking === 0 ? "Included, as the developer states — confirm." : undefined });
  if (t.clubhouse !== null) lines.push({ key: "clubhouse", label: "Clubhouse / amenities", amount: t.clubhouse, provenance: sheetProvenance("tco.clubhouse"), source: sheetSource("tco.clubhouse") });
  const extras = (property.tcoExtras ?? []).filter((x) => !SHEET_SKIP.test(x.label));
  for (const want of SHEET_LINE) {
    const item = extras.find((x) => want.match.test(x.label));
    lines.push(
      item && item.amount !== null
        ? { key: want.key, label: want.label, amount: item.amount, provenance: sheetProvenance("tcoExtras"), source: sheetSource("tcoExtras"), note: item.label }
        : { key: want.key, label: want.label, amount: null, provenance: null, source: "Not on the developer's cost sheet yet — being verified" },
    );
  }
  for (const item of extras.filter((x) => !SHEET_LINE.some((w) => w.match.test(x.label)))) {
    lines.push({ key: `extra:${item.label}`, label: item.label, amount: item.amount, provenance: sheetProvenance("tcoExtras"), source: sheetSource("tcoExtras") });
  }

  // ── Government charges, computed from the rates ──
  const gst = gstFor(property, base, opts.carpetSqft ?? null);
  if (gst.pct === null) {
    const stated = t.gst === 0 && fieldState(property, "tco.gst").status !== "pending";
    lines.push(
      stated
        ? { key: "gst", label: "GST", amount: 0, provenance: "builder", source: sheetSource("tco.gst"), note: `Nil, as the developer states. ${gst.why}` }
        : { key: "gst", label: "GST", amount: null, provenance: null, source: gst.why },
    );
  } else {
    lines.push({ key: "gst", label: `GST (${gst.pct}%)`, amount: Math.round((base * gst.pct) / 100), provenance: "computed", source: rateLabel(RATES.gst.meta), sourceDetail: rateNote(RATES.gst.meta), note: gst.why });
  }
  const sd = stampDuty(base);
  lines.push({ key: "stampDuty", label: `Stamp duty (${sd.pct}%)`, amount: sd.duty, provenance: "computed", source: rateLabel(RATES.karnataka.stampDuty.meta), sourceDetail: rateNote(RATES.karnataka.stampDuty.meta), note: "On the agreement value; Karnataka slab rate." });
  lines.push({ key: "stampCess", label: "Cess & surcharge on stamp duty", amount: sd.cessAndSurcharge, provenance: "computed", source: rateLabel(RATES.karnataka.stampDuty.meta), sourceDetail: rateNote(RATES.karnataka.stampDuty.meta), note: `${RATES.karnataka.stampDuty.cessPctOfDuty}% cess + ${RATES.karnataka.stampDuty.surchargePctOfDuty}% urban surcharge, on the duty.` });
  lines.push({ key: "registration", label: `Registration (${RATES.karnataka.registration.pct}%)`, amount: registrationFee(base), provenance: "computed", source: rateLabel(RATES.karnataka.registration.meta), sourceDetail: rateNote(RATES.karnataka.registration.meta) });

  const total = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  return { onRequest: false, lines, total, pending: lines.filter((l) => l.amount === null).map((l) => l.label), base };
}

/** The all-in total for a listing at its headline price (compare, Q&A, the worth tool), or null with no price. */
export function allInTotal(property: Property): number | null {
  const r = allInCost(property, { price: property.priceNum });
  return r.onRequest ? null : r.total;
}

/** Up-front costs a buyer can't recover (everything above the base price). */
export function transactionCosts(property: Property, price: number | null = property.priceNum): number | null {
  const r = allInCost(property, { price });
  return r.onRequest ? null : r.total - r.base;
}

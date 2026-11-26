import type { Property, Unit } from "../premium/contract";
import { allInCost, type CostLine } from "../premium/costs/all-in";
import { analysePlan, PLAN_DEFAULTS, type PlanId } from "../premium/costs/payment-plan";
import type { Property as CostProperty } from "../premium/costs/types";

/**
 * OPS-02 · THE ALL-IN COST SHEET for one unit — premium's own cost rules
 * (lib/premium/costs, mirrored verbatim and checked against premium by
 * `npm run verify`): base price, the developer's cost-sheet charges (parking,
 * clubhouse, legal, deposits, named extras), GST, Karnataka stamp duty + cess
 * and registration computed from the published rates. A charge nobody has
 * stated is "Developer to confirm" and is left out of the total — never
 * guessed. Floor rise is not in premium's rules: it appears only when the
 * developer's cost sheet names it, otherwise as "Developer to confirm".
 *
 * Payment plans are premium's standard schedules for the possession status
 * (ready → one payment; under construction → construction-linked,
 * down-payment, subvention with premium's default discount / premium), shown
 * in rupees for this unit and marked illustrative: the developer's own plan
 * governs. Pure.
 */

export type Standing = "developer" | "computed" | "to_confirm";

export interface SheetLine {
  key: string;
  label: string;
  amount: number | null;
  standing: Standing;
  source: string;
  note: string | null;
}

export interface PlanSchedule {
  id: PlanId;
  label: string;
  effectivePrice: number;
  /** What changes the price on this plan (premium's default discount / premium) — the developer's to confirm. */
  adjustment: string | null;
  instalments: { label: string; pct: number; amount: number }[];
}

export type CostSheet =
  | { onRequest: true; reason: string }
  | { onRequest: false; lines: SheetLine[]; total: number; base: number; toConfirm: string[]; plans: PlanSchedule[]; possession: string };

const FLOOR_RISE = /floor[- ]?rise|\bplc\b|preferential location/i;

export function toCostProperty(p: Property): CostProperty {
  return {
    possession: p.possession,
    propertyType: p.propertyType,
    priceNum: p.priceNum ?? p.salePrice,
    tco: { parking: p.tco?.parking ?? null, clubhouse: p.tco?.clubhouse ?? null, gst: p.tco?.gst ?? null },
    tcoExtras: (p.tcoExtras ?? []).map((x) => ({ label: x.label, amount: x.amount })),
    fieldStatus: (p.fieldStatus ?? {}) as unknown as CostProperty["fieldStatus"],
  };
}

const standing = (l: CostLine): Standing => (l.amount === null || l.provenance === "estimate" ? "to_confirm" : l.provenance === "computed" ? "computed" : "developer");

export function costSheet(property: Property, unit: Pick<Unit, "price" | "carpetSqft" | "indicative">): CostSheet {
  if (unit.indicative) return { onRequest: true, reason: "This unit is a layout placeholder — awaiting the confirmed layout and price." };
  const price = unit.price ?? null;
  if (price === null) return { onRequest: true, reason: "No price is stated for this unit yet — the developer's to confirm." };
  const r = allInCost(toCostProperty(property), { price, indicative: unit.indicative, carpetSqft: unit.carpetSqft ?? null });
  if (r.onRequest) return { onRequest: true, reason: "Price on request." };

  const lines: SheetLine[] = r.lines.map((l) => ({ key: l.key, label: l.label, amount: l.amount, standing: standing(l), source: l.source, note: l.note ?? null }));
  if (!lines.some((l) => FLOOR_RISE.test(l.label) || FLOOR_RISE.test(l.note ?? ""))) {
    lines.splice(1, 0, { key: "floorRise", label: "Floor rise", amount: null, standing: "to_confirm", source: "Not on the developer's cost sheet — developer to confirm", note: null });
  }
  const ready = property.possession === "ready";
  const ids: PlanId[] = ready ? ["ready"] : ["construction-linked", "down-payment", "subvention"];
  // Premium's analyser, with no loan: only the schedule and the plan's price matter here.
  const plans = ids.map((id): PlanSchedule => {
    const p = analysePlan(id, { price: r.base, cashNow: r.base * 2, monthlySavings: 0, loanPct: 0, loanRatePct: 0, monthsToPossession: PLAN_DEFAULTS.monthsToPossession, downPaymentDiscountPct: PLAN_DEFAULTS.downPaymentDiscountPct, subventionPremiumPct: PLAN_DEFAULTS.subventionPremiumPct });
    const merged = new Map<string, { label: string; pct: number }>();
    for (const s of p.schedule) {
      const m = merged.get(s.label) ?? { label: s.label, pct: 0 };
      m.pct += s.pct;
      merged.set(s.label, m);
    }
    return {
      id,
      label: p.label,
      effectivePrice: p.effectivePrice,
      adjustment: id === "down-payment" ? `${PLAN_DEFAULTS.downPaymentDiscountPct}% typical discount for paying up front — developer to confirm` : id === "subvention" ? `${PLAN_DEFAULTS.subventionPremiumPct}% typical premium over the base price — developer to confirm` : null,
      instalments: Array.from(merged.values()).map((s) => ({ label: s.label, pct: Math.round(s.pct * 100) / 100, amount: Math.round((p.effectivePrice * s.pct) / 100) })),
    };
  });
  return { onRequest: false, lines, total: r.total, base: r.base, toConfirm: lines.filter((l) => l.standing === "to_confirm").map((l) => l.label), plans, possession: property.possession };
}

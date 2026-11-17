/**
 * MIRRORED VERBATIM from the premium app (consumer-property-app/lib/calculators/payment-plan.ts) —
 * the same cost rules, so a proposal shows the figures the buyer sees on the
 * listing. Only the import lines differ. `npm run verify` runs premium's own
 * functions on the same inputs and fails if any figure differs. Change the
 * rule in premium, then copy it here.
 */
/**
 * PAYMENT-PLAN ANALYSER & MATCHING (FIN-04, PRM-28) — the three common ways to
 * pay for an under-construction home, run against the buyer's own cash flow,
 * and the closest fit. Pure and illustrative; a developer's actual plan and
 * price govern. Every assumption is a named default the buyer can change.
 *
 *   construction-linked  10% booking + 10% agreement, 75% in stages to
 *                        possession, 5% at possession. You pay interest on
 *                        the loan disbursed so far (pre-EMI) until possession.
 *   down-payment         95% within 45 days, 5% at possession, for a discount.
 *                        The loan is disbursed at once, so interest starts now.
 *   subvention           20% up front; the lender disburses in stages and the
 *                        developer pays the interest until possession — in
 *                        exchange the price is usually higher.
 *
 * Your own money goes in first (lenders disburse only after your share), the
 * loan funds the rest. A ready home has one plan: pay and take possession.
 */

export type PlanId = "construction-linked" | "down-payment" | "subvention" | "ready";

export const PLAN_LABEL: Record<PlanId, string> = {
  "construction-linked": "Construction-linked",
  "down-payment": "Down-payment",
  subvention: "Subvention",
  ready: "Ready to move",
};

export interface PlanInputs {
  price: number;
  /** Cash you can put in today (savings), beyond the closing costs. */
  cashNow: number;
  /** What you can set aside each month toward the home. */
  monthlySavings: number;
  /** Your loan, as a share of the price (≤ the LTV cap). */
  loanPct: number;
  loanRatePct: number;
  monthsToPossession: number;
  /** Discount a developer typically gives for paying up front. */
  downPaymentDiscountPct: number;
  /** Premium a subvention plan usually carries over the base price. */
  subventionPremiumPct: number;
}

export const PLAN_DEFAULTS = { loanPct: 80, downPaymentDiscountPct: 6, subventionPremiumPct: 4, monthsToPossession: 24 } as const;

export interface PlanResult {
  id: PlanId;
  label: string;
  /** What the home costs on this plan (after a discount / with a premium). */
  effectivePrice: number;
  /** Your money due in the first month. */
  upfront: number;
  /** Interest you pay before possession (pre-EMI, or EMI interest on a full disbursal). */
  interestBeforePossession: number;
  /** The most you pay in any one month before possession (your instalments + interest). */
  peakMonthly: number;
  /** effectivePrice + interest you bear before possession. */
  totalCost: number;
  /** Your cash can meet every month's dues. */
  fits: boolean;
  /** The largest cash gap if it doesn't fit (0 when it does). */
  shortfall: number;
  schedule: { month: number; pct: number; label: string }[];
}

function schedule(id: PlanId, months: number): { month: number; pct: number; label: string }[] {
  const m = Math.max(1, Math.round(months));
  if (id === "down-payment") return [{ month: 0, pct: 95, label: "Within 45 days" }, { month: m, pct: 5, label: "At possession" }];
  if (id === "ready") return [{ month: 0, pct: 100, label: "On registration" }];
  if (id === "subvention") {
    const stages = Math.min(8, m);
    return [{ month: 0, pct: 20, label: "Booking" }, ...Array.from({ length: stages }, (_, i) => ({ month: Math.round(((i + 1) * m) / stages), pct: 80 / stages, label: `Stage ${i + 1}` }))];
  }
  const stages = Math.min(8, m);
  return [
    { month: 0, pct: 10, label: "Booking" },
    { month: Math.min(1, m), pct: 10, label: "Agreement" },
    ...Array.from({ length: stages }, (_, i) => ({ month: Math.round(((i + 1) * m) / stages), pct: 75 / stages, label: `Stage ${i + 1}` })),
    { month: m, pct: 5, label: "At possession" },
  ];
}

export function analysePlan(id: PlanId, input: PlanInputs): PlanResult {
  const months = id === "ready" ? 0 : Math.max(1, Math.round(input.monthsToPossession));
  const effectivePrice = Math.round(input.price * (id === "down-payment" ? 1 - input.downPaymentDiscountPct / 100 : id === "subvention" ? 1 + input.subventionPremiumPct / 100 : 1));
  const plan = schedule(id, months);
  const loanTotal = (effectivePrice * Math.min(100, Math.max(0, input.loanPct))) / 100;
  let ownLeft = effectivePrice - loanTotal;
  let disbursed = 0;
  let cash = input.cashNow;
  let interest = 0;
  let shortfall = 0;
  let peak = 0;
  let upfront = 0;
  const r = input.loanRatePct / 100 / 12;
  for (let month = 0; month <= months; month += 1) {
    if (month > 0) cash += input.monthlySavings;
    const due = plan.filter((p) => p.month === month).reduce((s, p) => s + (effectivePrice * p.pct) / 100, 0);
    // Your share first, then the lender.
    const fromOwn = Math.min(due, ownLeft);
    ownLeft -= fromOwn;
    disbursed += due - fromOwn;
    // Interest for the month on what's disbursed, until possession (the developer pays it under subvention).
    const monthInterest = month < months && id !== "subvention" ? disbursed * r : 0;
    interest += monthInterest;
    const out = fromOwn + monthInterest;
    if (month === 0) upfront = Math.round(out);
    peak = Math.max(peak, out);
    cash -= out;
    if (cash < 0) shortfall = Math.max(shortfall, -cash);
  }
  return {
    id,
    label: PLAN_LABEL[id],
    effectivePrice,
    upfront,
    interestBeforePossession: Math.round(interest),
    peakMonthly: Math.round(peak),
    totalCost: Math.round(effectivePrice + interest),
    fits: shortfall === 0,
    shortfall: Math.round(shortfall),
    schedule: plan,
  };
}

export interface PlanMatch {
  plans: PlanResult[];
  recommended: PlanId;
  why: string;
}

/** Every applicable plan for this home, and the closest fit to the buyer's cash flow. */
export function matchPlans(input: PlanInputs, possession: "ready" | "under-construction"): PlanMatch {
  const ids: PlanId[] = possession === "ready" ? ["ready"] : ["construction-linked", "down-payment", "subvention"];
  const plans = ids.map((id) => analysePlan(id, input));
  const fitting = plans.filter((p) => p.fits).sort((a, b) => a.totalCost - b.totalCost);
  if (possession === "ready") {
    const p = plans[0];
    return { plans, recommended: "ready", why: p.fits ? "A ready home is paid for at registration; your cash covers your share." : `Your share at registration is short by about ₹${p.shortfall.toLocaleString("en-IN")} — a larger loan or more savings first.` };
  }
  if (fitting.length) {
    const best = fitting[0];
    const next = fitting[1];
    return {
      plans,
      recommended: best.id,
      why: `${best.label} fits your cash every month and costs the least of the plans that do${next ? ` — about ₹${(next.totalCost - best.totalCost).toLocaleString("en-IN")} less than ${next.label.toLowerCase()}` : ""}.`,
    };
  }
  const closest = [...plans].sort((a, b) => a.shortfall - b.shortfall)[0];
  return { plans, recommended: closest.id, why: `No plan fits your cash flow as entered; ${closest.label.toLowerCase()} comes closest, short by about ₹${closest.shortfall.toLocaleString("en-IN")} at its tightest month.` };
}

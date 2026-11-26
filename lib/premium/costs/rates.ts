/**
 * MIRRORED VERBATIM from the premium app (consumer-property-app/lib/costs/rates.ts) —
 * the same cost rules, so a proposal shows the figures the buyer sees on the
 * listing. Only the import lines differ. `npm run verify` runs premium's own
 * functions on the same inputs and fails if any figure differs. Change the
 * rule in premium, then copy it here.
 */
/**
 * GOVERNMENT RATES for the all-in cost view (PRM-21) and the calculators
 * (PRM-13). Every figure carries its source, the date it took effect (when the
 * source gives one) and the date we last checked it. Change a rate HERE and
 * every computed figure follows — nothing else hardcodes a rate.
 *
 * The figures are what the cited sources say on `checkedOn`. Before any of them
 * is relied on for a real transaction, confirm against the primary source
 * (Kaveri / IGR Karnataka for stamp duty and registration; CBIC for GST).
 */

export interface RateSource {
  /** A short name for the line ("Karnataka stamp duty slabs"). */
  label: string;
  /** What the figure rests on, in full. */
  source: string;
  sourceUrl: string | null;
  /** When the rate took effect (YYYY-MM-DD), when the source states it. */
  effectiveFrom: string | null;
  /** When we last checked it against the source. */
  checkedOn: string;
}

export interface StampDutySlab {
  /** Applies to an agreement value up to this many rupees (null = no upper limit). */
  upTo: number | null;
  pct: number;
}

export const RATES = {
  karnataka: {
    stampDuty: {
      slabs: [
        { upTo: 20_00_000, pct: 2 },
        { upTo: 45_00_000, pct: 3 },
        { upTo: null, pct: 5 },
      ] satisfies StampDutySlab[],
      /** Cess and urban surcharge, each as a percent OF THE STAMP DUTY (not of the value). */
      cessPctOfDuty: 10,
      surchargePctOfDuty: 2,
      meta: {
        label: "Karnataka stamp duty slabs",
        source: "Karnataka Stamp Act (Article 20, conveyance): 2% up to ₹20 L, 3% ₹20–45 L, 5% above ₹45 L, plus 10% cess and 2% urban surcharge on the duty — as published by Bajaj Housing Finance and Godrej Capital (2025)",
        sourceUrl: "https://www.bajajhousingfinance.in/resources/stamp-duty-and-property-registration-in-karnataka",
        effectiveFrom: null,
        checkedOn: "2026-11-02",
      } satisfies RateSource,
    },
    registration: {
      pct: 2,
      meta: {
        label: "Karnataka registration fee",
        source: "Government of Karnataka Notification No. RD/46/MNMU/2025 (29 Aug 2025): registration fee raised from 1% to 2%",
        sourceUrl: "https://www.angelone.in/news/market-updates/karnataka-to-double-property-registration-fee-to-2-effective-august-31",
        effectiveFrom: "2025-08-31",
        checkedOn: "2026-11-02",
      } satisfies RateSource,
    },
  },
  gst: {
    /** Under-construction residential, not affordable: % of the agreement value, no input tax credit. */
    underConstructionPct: 5,
    /** Affordable housing (both limits met). */
    affordablePct: 1,
    affordableMaxPrice: 45_00_000,
    /** Carpet-area limit in a metro (Bengaluru), square metres. */
    affordableMaxCarpetSqmMetro: 60,
    /** Ready-to-move with the completion / occupancy certificate issued. */
    readyWithCertificatePct: 0,
    meta: {
      label: "GST rules for residential homes",
      source: "GST on residential construction services — Notification No. 03/2019-Central Tax (Rate), as amended: 5% (1% affordable) without ITC on under-construction homes; none once the completion / occupancy certificate is issued",
      sourceUrl: "https://www.sobha.com/blog/gst-rate-on-real-estate-flat-purchase/",
      effectiveFrom: "2019-04-01",
      checkedOn: "2026-11-02",
    } satisfies RateSource,
  },
} as const;

/** "Karnataka registration fee · effective 31 Aug 2025 · checked 2 Nov 2026" — the short provenance on a line. */
export function rateLabel(meta: RateSource): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${meta.label}${meta.effectiveFrom ? ` · effective ${fmt(meta.effectiveFrom)}` : ""} · checked ${fmt(meta.checkedOn)}`;
}

/** The full citation — shown on hover and kept with the figure. */
export function rateNote(meta: RateSource): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${meta.source}${meta.effectiveFrom ? ` · effective ${fmt(meta.effectiveFrom)}` : ""} · checked ${fmt(meta.checkedOn)}`;
}

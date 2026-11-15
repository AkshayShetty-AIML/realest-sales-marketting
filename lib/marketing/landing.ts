import type { Property } from "../premium/contract";
import type { BrandKit, Magnet } from "../premium/marketing-contract";
import { factValue, type Fact } from "../grounding/facts";
import { carpetSqft, gradeFact, type MarketingFacts } from "./facts";

/**
 * PER-PROJECT LANDING PAGE — composed deterministically from the spine record
 * (verified data + media + honest grade + RERA) and the brand kit. Every
 * section is filled from a fact; a missing fact drops its section, nothing is
 * invented. Stored as landing_pages.content (JSON) and rendered by
 * components/marketing/project/ProjectPage.tsx (live). Pure.
 */

export interface LandingMedia {
  url: string;
  /** What the viewer is told: real listing photo, placeholder, staged, AI. */
  label: string;
  placeholder: boolean;
}

export interface LandingContent {
  version: 1;
  generatedAt: string;
  /**
   * How the page text was produced: "template" (deterministic, from spine
   * facts) or "llm" (the hero line only was AI-written and passed the claims
   * guard — lib/marketing/generate.ts writeLandingHeroLine).
   */
  engine: "llm" | "template";
  label: string;
  brand: { builderName: string | null; primaryColor: string; secondaryColor: string; headingFont: string; bodyFont: string; logoUrl: string | null };
  hero: { headline: string; subhead: string | null; media: LandingMedia[] };
  grade: { grade: string; score: number | null; breakdown: { label: string; score: number }[]; note: string } | null;
  pricing: { price: string; carpetArea: string; line: string } | null;
  facts: { key: string; label: string; value: string }[];
  amenities: string[];
  rera: { regNo: string; status: string };
  magnets: Magnet[];
  factKeys: string[];
  warnings: string[];
}

const RERA_STATUS: Record<string, string> = {
  "on-time": "RERA-registered · on schedule (platform data)",
  delayed: "RERA-registered · currently behind schedule (platform data)",
};

/** Placeholder hosts used by the demo catalogue — never passed off as the real project. */
const PLACEHOLDER = /picsum\.photos|placehold|unsplash\.it/i;

export function composeLanding(property: Property, kit: BrandKit | null, grounding: MarketingFacts, now = new Date()): LandingContent {
  const facts: Fact[] = grounding.facts;
  const v = (k: string) => factValue(facts, k);
  const rera = grounding.reraRegNo;
  if (!rera) throw new Error("A RERA registration number is required (Brand settings).");

  const images = Array.isArray(property.images) ? (property.images.filter((x) => typeof x === "string") as string[]) : [];
  const media: LandingMedia[] = images.slice(0, 4).map((url, i) => {
    const placeholder = PLACEHOLDER.test(url);
    return { url, placeholder, label: placeholder ? "Placeholder photo (demo) — not the actual project" : `Listing photo ${i + 1} (from the platform's media)` };
  });

  const g = gradeFact(property);
  const breakdown = property.gradeBreakdown
    ? (Object.entries({ Delivery: property.gradeBreakdown.delivery, Legal: property.gradeBreakdown.legal, Reviews: property.gradeBreakdown.reviews }).filter(([, s]) => typeof s === "number") as [string, number][]).map(([label, score]) => ({ label, score }))
    : [];

  const carpet = carpetSqft(property);
  const pricing = v("price") && carpet && property.salePrice !== null
    ? { price: (v("price") as string).split(" for ")[0], carpetArea: `${carpet.toLocaleString("en-IN")} sq ft carpet area`, line: v("price") as string }
    : null;

  const shown = ["config", "type", "location", "possession", "carpet_area", "availability", "gated", "metro"];
  const factRows = shown.flatMap((k) => {
    const f = facts.find((x) => x.key === k);
    return f ? [{ key: f.key, label: f.label, value: f.value }] : [];
  });

  const headline = `${v("config") ? `${v("config")} homes at ` : ""}${property.name}`;
  const subhead = [v("location"), v("builder") ? `by ${v("builder")}` : null].filter(Boolean).join(" · ") || null;

  return {
    version: 1,
    generatedAt: now.toISOString(),
    engine: "template",
    label: "Generated from verified platform data (template)",
    brand: {
      builderName: kit?.builderName ?? null,
      primaryColor: kit?.primaryColor ?? "#0f6b46",
      secondaryColor: kit?.secondaryColor ?? "#b7791f",
      headingFont: kit?.headingFont ?? "Playfair Display",
      bodyFont: kit?.bodyFont ?? "Inter",
      logoUrl: kit?.logoUrl ?? null,
    },
    hero: { headline, subhead, media },
    grade: g
      ? { grade: property.grade, score: typeof property.gradeScore === "number" ? property.gradeScore : null, breakdown, note: "The platform's honest grade from delivery, legal and resident-review data — shown as is." }
      : null,
    pricing,
    facts: factRows,
    amenities: (v("amenities") ?? "").split(", ").filter(Boolean),
    rera: { regNo: rera, status: RERA_STATUS[property.trust.rera] ?? `RERA: ${property.trust.reraNote ?? "not applicable"}` },
    magnets: ["brochure", "price_list", "eligibility", "register_interest"],
    factKeys: Array.from(new Set([...factRows.map((f) => f.key), ...(pricing ? ["price"] : []), ...(g ? ["grade"] : []), ...(v("amenities") ? ["amenities"] : []), "name", "builder"])),
    warnings: grounding.warnings,
  };
}

/** Slug for a new page: the property id + a short suffix (unique per page). */
export const landingSlug = (propertyId: string, suffix: string) => `${propertyId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60)}-${suffix}`.replace(/-+/g, "-");

/**
 * INDICATIVE home-loan eligibility (the "eligibility check" magnet). Plain
 * arithmetic on the buyer's own inputs with stated assumptions — not a loan
 * offer, and labelled so. Pure.
 */
export const ELIGIBILITY_ASSUMPTIONS = { foir: 0.5, annualRatePct: 8.5, years: 20 } as const;

export function loanEligibility(monthlyIncome: number, existingEmis: number) {
  const { foir, annualRatePct, years } = ELIGIBILITY_ASSUMPTIONS;
  const maxEmi = Math.max(0, monthlyIncome * foir - existingEmis);
  const r = annualRatePct / 1200;
  const n = years * 12;
  const loan = maxEmi > 0 ? (maxEmi * (Math.pow(1 + r, n) - 1)) / (r * Math.pow(1 + r, n)) : 0;
  return { maxEmi: Math.round(maxEmi), loan: Math.round(loan / 1000) * 1000, assumptions: ELIGIBILITY_ASSUMPTIONS };
}

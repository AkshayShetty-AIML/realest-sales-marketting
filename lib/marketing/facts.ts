import type { Property } from "../premium/contract";
import { inr, shortDate, type Fact } from "../grounding/facts";
import type { BrandKit } from "../premium/marketing-contract";

/**
 * THE MARKETING FACT SHEET — the only things generated marketing may say about
 * a building. Built from the spine's GET /properties/:id and nothing else.
 * Stricter than the sales reply sheet (lib/grounding/facts.ts) because ads are
 * RERA-regulated advertising:
 *
 *  - AREA is the CARPET area only (RERA: sale on carpet area). Super built-up
 *    area and the super-built-up price per sq ft are NEVER stated.
 *  - PRICE is stated only for a sale listing AND only with its carpet area
 *    ("₹1.15 Cr for 1,240 sq ft carpet area"). No carpet area → no price.
 *  - No forecasts, yields, grades-as-boasts, reviews or negotiation hints in
 *    copy: they are opinions or projections, not facts a buyer can rely on.
 *    (The honest grade appears only on the landing page, as the spine states it.)
 *  - Availability always carries its last-verified date.
 *  - Absent data → no fact → the copy simply doesn't mention it.
 * Pure.
 */

export type { Fact };

export interface MarketingFacts {
  facts: Fact[];
  /** The RERA registration number every asset carries (from the brand kit), or null → generation is blocked. */
  reraRegNo: string | null;
  /** Things the operator should know before using the copy (never shown to buyers). */
  warnings: string[];
}

const humanize = (kind: string) => kind.replace(/-/g, " ");

export function carpetSqft(property: Property): number | null {
  const specs = (property as { specs?: { carpetSqft?: unknown } }).specs;
  return typeof specs?.carpetSqft === "number" && specs.carpetSqft > 0 ? specs.carpetSqft : null;
}

export function buildMarketingFacts(property: Property, kit: BrandKit | null): MarketingFacts {
  const facts: Fact[] = [];
  const warnings: string[] = [];
  const add = (key: string, label: string, value: string | null | undefined) => {
    if (value) facts.push({ key, label, value });
  };
  const carpet = carpetSqft(property);
  const forSale = property.availableFor.includes("buy") && property.salePrice !== null;

  add("name", "Project", property.name);
  add("builder", "Builder", property.builder);
  add("location", "Location", `${property.locality}, ${property.city}`);
  add("locality", "Locality", property.locality);
  add("type", "Type", humanize(property.propertyType));
  add("config", "Configuration", property.config);
  if (carpet) add("carpet_area", "Carpet area", `${carpet.toLocaleString("en-IN")} sq ft carpet area`);
  else warnings.push("This project has no carpet area on record, so area and price are left out.");
  if (forSale && carpet) add("price", "Price", `${inr(property.salePrice as number)} for ${carpet.toLocaleString("en-IN")} sq ft carpet area`);
  else if (forSale) warnings.push("Price left out: RERA needs prices on carpet area, and the carpet area isn't on record.");
  add("possession", "Possession", property.possession === "ready" ? "ready to move in" : `under construction (${property.constructionPct}% built)`);
  const amenities = (property.amenities ?? []).filter((a) => a.condition !== "planned").map((a) => a.name ?? humanize(a.kind));
  if (amenities.length > 0) add("amenities", "Amenities", amenities.slice(0, 6).join(", "));
  if (property.gatedCommunity) add("gated", "Community", "gated community");
  if (property.nearMetro) add("metro", "Transit", "close to a metro station");
  const inv = property.inventory;
  if (inv.total > 0 && inv.lastVerifiedAt) add("availability", "Availability", `${inv.available} of ${inv.total} units available as of ${shortDate(inv.lastVerifiedAt)}`);

  if (!property.verified) warnings.push("This project's details haven't been verified yet — read every line before sending it for approval.");
  if (property.trust.rera === "not-applicable") warnings.push(`Our records say RERA doesn't apply to this project (${property.trust.reraNote ?? "no reason given"}) — please check before advertising.`);
  if (kit?.builderName && kit.builderName !== property.builder) warnings.push(`Your brand settings are for ${kit.builderName}, but this project is by ${property.builder}.`);
  const reraRegNo = kit?.defaultReraRegNo ?? null;
  if (!reraRegNo) warnings.push("Add your RERA registration number in Brand settings first.");
  return { facts, reraRegNo, warnings };
}

/**
 * The honest grade, exactly as the spine states it — for the landing page
 * only (M6), never boasted about in ad copy.
 */
export function gradeFact(property: Property): Fact | null {
  return property.grade ? { key: "grade", label: "Honest grade", value: `${property.grade}${typeof property.gradeScore === "number" ? ` (${property.gradeScore}/100)` : ""}` } : null;
}

export const reraLine = (reraRegNo: string) => `RERA Reg. No.: ${reraRegNo}`;

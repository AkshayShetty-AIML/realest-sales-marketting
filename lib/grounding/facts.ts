import type { Property } from "../premium/contract";

/**
 * THE FACT SHEET — the only things an auto-reply may say about a property.
 * Built from GET /properties/:id and nothing else. Each fact has a stable key
 * so every reply records which facts it rests on (AutoReply.factKeys).
 *
 * Honesty rules carried over from the premium app:
 *  - A sale price is stated only when the home is offered for sale. A rent-
 *    or invest-only home's `priceLabel` is a valuation and is never quoted.
 *  - Inventory is stated with its last-verified date, never as a bare claim.
 *  - Absent data produces no fact — the composer then hands that topic to a human.
 * Pure.
 */

export interface Fact {
  key: string;
  label: string;
  value: string;
}

export function inr(amount: number): string {
  if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(2).replace(/\.?0+$/, "")} lakh`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const humanize = (kind: string) => kind.replace(/-/g, " ");

export function buildFacts(property: Property): Fact[] {
  const facts: Fact[] = [];
  const add = (key: string, label: string, value: string | null | undefined) => {
    if (value) facts.push({ key, label, value });
  };
  const forSale = property.availableFor.includes("buy") && property.salePrice !== null;
  const forRent = property.availableFor.includes("rent") && property.rentPerMonth !== null;
  const fractional = (property as { fractional?: { minTicket?: number; targetYieldPct?: number | null } | null }).fractional;

  add("name", "Project", property.name);
  add("builder", "Builder", property.builder);
  add("location", "Location", `${property.locality}, ${property.city}`);
  add("type", "Type", humanize(property.propertyType));
  add("config", "Configuration", property.config);
  add("area", "Area", `${property.areaSqft.toLocaleString("en-IN")} sq ft`);
  add(
    "possession",
    "Possession",
    property.possession === "ready" ? "ready to move in" : `under construction (${property.constructionPct}% built)`,
  );
  if (forSale) {
    add("sale_price", "Asking price", inr(property.salePrice as number));
    add("price_per_sqft", "Price per sq ft", property.pricePerSqftLabel);
  }
  if (forRent) add("rent", "Rent", `${inr(property.rentPerMonth as number)} per month`);
  if (property.availableFor.includes("invest") && fractional?.minTicket) {
    add("min_ticket", "Minimum investment (fractional, simulated offer)", inr(fractional.minTicket));
  }
  add(
    "rera",
    "RERA",
    property.trust.rera === "on-time"
      ? "RERA-registered, on schedule"
      : property.trust.rera === "delayed"
        ? "RERA-registered, currently behind schedule"
        : `RERA not applicable${property.trust.reraNote ? ` (${property.trust.reraNote})` : ""}`,
  );
  const inv = property.inventory;
  if (inv.total > 0) {
    add(
      "availability",
      "Availability",
      `${inv.available} of ${inv.total} unit${inv.total === 1 ? "" : "s"} available${inv.lastVerifiedAt ? ` (last verified ${shortDate(inv.lastVerifiedAt)})` : ""}`,
    );
  }
  const amenities = (property.amenities ?? []).filter((a) => a.condition !== "planned").map((a) => a.name ?? humanize(a.kind));
  if (amenities.length > 0) add("amenities", "Amenities", amenities.slice(0, 8).join(", "));
  if (property.gatedCommunity) add("gated", "Community", "gated community");
  if (property.nearMetro) add("metro", "Transit", "close to a metro station");
  return facts;
}

export const factValue = (facts: Fact[], key: string) => facts.find((f) => f.key === key)?.value ?? null;

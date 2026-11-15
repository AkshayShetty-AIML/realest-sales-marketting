import type { LeadDetail, Property } from "../premium/contract";
import { deriveContext } from "../automation/context";
import { buildFacts, factValue, inr, shortDate, type Fact } from "../grounding/facts";
import { greetingName } from "../grounding/compose";

/**
 * PERSONALISED BROCHURE — WHAT it says. Pure and deterministic: the property
 * (GET /properties/:id) + the buyer's STATED requirements (from their own
 * messages) + the honest grade and key data. Nothing here is invented: every
 * line is a fact-sheet value, a premium field, or the buyer's own words.
 *
 * Honesty, carried over from the premium app:
 *  - the grade is shown as-is, with what it rests on — never rounded up;
 *  - where the home DOESN'T match what they asked for, the brochure says so;
 *  - "things to check" lists the real caveats (construction %, RERA delay,
 *    litigation, stale inventory) instead of hiding them;
 *  - a price is quoted only when the home is offered for sale (or rent).
 * The narrative paragraph may be rewritten by the LLM (lib/brochure/generate.ts),
 * under the same grounding guard as replies; the rest is never AI-written.
 */

export interface FitRow {
  label: string;
  /** What the buyer said (or "not stated"). */
  stated: string;
  /** What this home is. */
  home: string;
  verdict: "match" | "differs" | "check" | "not_stated";
}

export interface BrochureContent {
  version: 1;
  generatedAt: string;
  buyerFirstName: string | null;
  property: {
    id: string;
    name: string;
    builder: string;
    place: string;
    type: string;
    priceLine: string | null;
    grade: string;
    gradeScore: number | null;
    gradeParts: { label: string; value: number }[];
    verified: boolean;
  };
  headline: string;
  /** The narrative — AI-written when available (guarded), else composed. */
  intro: string;
  fit: FitRow[];
  keyFacts: { label: string; value: string }[];
  highlights: string[];
  thingsToCheck: string[];
  inventory: { available: number; total: number; lastVerifiedAt: string | null };
  nextStep: string;
  /** Fact keys the brochure rests on (audit trail). */
  factKeys: string[];
}

const BHK = /\b([1-6])\s*-?\s*bhk\b/i;
const BUDGET = /(\d+(?:\.\d+)?)\s*(cr|crore|crores|lakh|lakhs|lac|l)\b/i;

function budgetValue(m: RegExpMatchArray): number {
  const n = Number(m[1]);
  return /^(cr|crore|crores)$/i.test(m[2]) ? n * 1e7 : n * 1e5;
}

export function composeIntro(c: Pick<BrochureContent, "buyerFirstName" | "property" | "fit">, facts: Fact[]): string {
  const hi = c.buyerFirstName ? `${c.buyerFirstName}, ` : "";
  const matches = c.fit.filter((f) => f.verdict === "match").map((f) => f.label.toLowerCase());
  const differs = c.fit.filter((f) => f.verdict === "differs").map((f) => f.label.toLowerCase());
  const loc = factValue(facts, "location");
  const cfg = factValue(facts, "config");
  const poss = factValue(facts, "possession");
  const parts = [
    `${hi}this brochure is put together for you from the verified record of ${c.property.name}${loc ? ` in ${loc}` : ""}.`,
    cfg || poss ? `It is ${[cfg, poss].filter(Boolean).join(", ")}.` : "",
    matches.length ? `It matches what you told us on ${matches.join(" and ")}.` : "",
    differs.length ? `It differs from what you asked for on ${differs.join(" and ")} — we've set that out plainly below.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export function composeBrochure(lead: LeadDetail, property: Property, now = new Date()): BrochureContent {
  const facts = buildFacts(property);
  const ctx = deriveContext(lead, property, now.getTime());
  const said = [lead.message, ...lead.messages.filter((m) => m.direction === "inbound").map((m) => m.body)].join(" ");
  const forSale = property.availableFor.includes("buy") && property.salePrice !== null;
  const forRent = property.availableFor.includes("rent") && property.rentPerMonth !== null;

  // ── Fit: stated requirements vs this home ──
  const fit: FitRow[] = [];
  const bhk = said.match(BHK);
  const homeBhk = property.config?.match(/(\d)/)?.[1] ?? null;
  fit.push({
    label: "Configuration",
    stated: bhk ? `${bhk[1]} BHK` : "not stated",
    home: property.config ?? property.propertyType.replace(/-/g, " "),
    verdict: !bhk ? "not_stated" : !homeBhk ? "check" : bhk[1] === homeBhk ? "match" : "differs",
  });
  const budget = said.match(BUDGET);
  const price = forSale ? property.salePrice : null;
  fit.push({
    label: "Budget",
    stated: budget ? budget[0].trim() : "not stated",
    home: price ? inr(price) : forRent ? `${inr(property.rentPerMonth as number)} / month (rent)` : "price on request",
    verdict: !budget ? "not_stated" : !price ? "check" : price <= budgetValue(budget) ? "match" : "differs",
  });
  const timeline = ctx.requirements.find((r) => r.label === "Timeline")?.value ?? "not stated";
  const ready = property.possession === "ready";
  fit.push({
    label: "Move-in",
    stated: timeline.replace(/ \(stated\)$/, ""),
    home: ready ? "ready to move in" : `under construction (${property.constructionPct}% built)`,
    verdict: timeline.startsWith("not stated") ? "not_stated" : ready ? "match" : "check",
  });

  // ── Key facts (fact sheet only) ──
  const KEY = ["location", "type", "config", "area", "possession", "sale_price", "price_per_sqft", "rent", "rera"];
  const keyFacts = KEY.map((k) => facts.find((f) => f.key === k)).filter((f): f is Fact => Boolean(f)).map((f) => ({ label: f.label, value: f.value }));
  const highlights = [factValue(facts, "amenities"), factValue(facts, "gated"), factValue(facts, "metro")].filter((x): x is string => Boolean(x));

  // ── Honest caveats ──
  const thingsToCheck: string[] = [];
  if (!ready) thingsToCheck.push(`Under construction — ${property.constructionPct}% built. Ask for the builder's committed possession date in writing.`);
  if (property.trust.rera === "delayed") thingsToCheck.push("RERA shows this project behind its registered schedule.");
  if (property.trust.rera === "not-applicable") thingsToCheck.push(`No RERA registration to rely on${property.trust.reraNote ? ` (${property.trust.reraNote})` : ""} — verify title documents independently.`);
  if (property.trust.litigation === "some") thingsToCheck.push("Some litigation is on record for this project — ask for the status before you commit.");
  if (property.trust.litigation === "high") thingsToCheck.push("Significant litigation is on record for this project — get independent legal advice.");
  for (const f of fit.filter((x) => x.verdict === "differs")) thingsToCheck.push(`${f.label}: you asked for ${f.stated}; this home is ${f.home}.`);
  const inv = property.inventory;
  if (inv.total > 0 && inv.available === 0) thingsToCheck.push("No units are currently available — ask to be told if one frees up.");
  if (inv.lastVerifiedAt && now.getTime() - Date.parse(inv.lastVerifiedAt) > 30 * 86_400_000) thingsToCheck.push(`Availability was last verified ${shortDate(inv.lastVerifiedAt)} — we'll re-confirm before any visit.`);
  if (!forSale && !forRent && property.availableFor.includes("invest")) thingsToCheck.push("Offered as a fractional investment only; the listed value is a valuation, not a sale price.");

  const breakdown = property.gradeBreakdown ?? {};
  const gradeParts = (["delivery", "legal", "reviews"] as const)
    .filter((k) => typeof breakdown[k] === "number")
    .map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: breakdown[k] as number }));

  const base = {
    buyerFirstName: greetingName(lead.contact.name),
    property: {
      id: property.id,
      name: property.name,
      builder: property.builder,
      place: `${property.locality}, ${property.city}`,
      type: [property.config, property.propertyType.replace(/-/g, " ")].filter(Boolean).join(" · "),
      priceLine: forSale ? `${inr(property.salePrice as number)} · ${property.pricePerSqftLabel}` : forRent ? `${inr(property.rentPerMonth as number)} per month` : null,
      grade: property.grade,
      gradeScore: property.gradeScore ?? null,
      gradeParts,
      verified: property.verified,
    },
    fit,
  };
  return {
    version: 1,
    generatedAt: now.toISOString(),
    ...base,
    headline: base.buyerFirstName ? `${property.name}, for ${base.buyerFirstName}` : property.name,
    intro: composeIntro(base, facts),
    keyFacts,
    highlights,
    thingsToCheck,
    inventory: { available: inv.available, total: inv.total, lastVerifiedAt: inv.lastVerifiedAt },
    nextStep: "See it in person: reply in your inbox in the app to book a site visit at a time that suits you.",
    factKeys: facts.map((f) => f.key),
  };
}

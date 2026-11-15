import { factNumbers } from "../grounding/guard";
import type { Fact } from "../grounding/facts";
import { reraLine } from "./facts";

/**
 * THE MARKETING CLAIMS GUARD — every piece of generated or edited copy runs
 * through it before it can be saved as a draft. Pure. Rules:
 *
 *  1. Every number is in the fact sheet (or the RERA reg no.). No invented
 *     prices, areas, dates, counts or percentages.
 *  2. Carpet-area disclosure: any area or price must say "carpet".
 *  3. No misleading claims: guaranteed / assured returns, "best", "No. 1",
 *     "lowest price", discounts, false urgency, appreciation or yield promises.
 *  4. No links, emails or phone numbers.
 *  5. Carries the RERA reg no. line.
 *  6. Fits its format.
 */

export const MAX_CHARS: Record<string, number> = { social_post: 900, caption: 300, ad_copy: 600, video: 1500, landing: 4000 };

const NUMBER = /\d+(?:[.,]\d+)*/g;
const normalize = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

const MISLEADING = /\b(guarantee[ds]?|assured|risk[- ]free|best|no\.? ?1|number one|lowest|cheapest|discount|offer ends|hurry|last few|limited (?:period|time)|appreciat\w*|returns?|roi|yield|investment opportunity|luxur\w*|world[- ]class|unbeatable|never before)\b/i;

export interface GuardResult {
  ok: boolean;
  problems: string[];
}

export function guardCopy(text: string, facts: Fact[], reraRegNo: string, format: keyof typeof MAX_CHARS): GuardResult {
  const problems: string[] = [];
  const body = text.trim();
  if (!body) problems.push("empty copy");
  if (body.length > MAX_CHARS[format]) problems.push(`longer than ${MAX_CHARS[format]} characters`);

  const allowed = factNumbers(facts);
  for (const n of reraRegNo.match(NUMBER) ?? []) allowed.add(normalize(n));
  const stray = Array.from(new Set((body.match(NUMBER) ?? []).map(normalize).filter((n) => !allowed.has(n))));
  if (stray.length > 0) problems.push(`numbers not in the verified data: ${stray.join(", ")}`);

  const withoutRera = body.replace(reraLine(reraRegNo), "");
  if (/\b(sq\.? ?ft|sqft|square feet|₹|rs\.?|inr|lakh|crore|cr)\b|₹/i.test(withoutRera) && !/carpet/i.test(withoutRera)) {
    problems.push("area or price stated without saying it is carpet area");
  }
  if (/super[- ]?built|built[- ]?up/i.test(withoutRera)) problems.push("mentions super built-up area (RERA: carpet area only)");
  const misleading = withoutRera.match(MISLEADING);
  if (misleading) problems.push(`misleading claim: "${misleading[0]}"`);
  if (/https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i.test(withoutRera)) problems.push("contains a link or email");
  if (/\+?\d[\d\s-]{8,}\d/.test(withoutRera)) problems.push("contains a phone-like number");
  if (!body.includes(reraLine(reraRegNo))) problems.push("missing the RERA Reg. No. line");
  return { ok: problems.length === 0, problems };
}

/** Make sure the RERA line closes the copy (re-added if an edit dropped it). */
export function withReraLine(text: string, reraRegNo: string): string {
  const line = reraLine(reraRegNo);
  const trimmed = text.replace(/\n?RERA Reg\. No\.:[^\n]*$/m, "").trimEnd();
  return `${trimmed}\n${line}`;
}

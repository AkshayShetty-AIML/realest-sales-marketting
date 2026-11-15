import type { Fact } from "./facts";

/**
 * THE GROUNDING GUARD — run on every LLM draft before it can be sent. A draft
 * that fails ANY rule is discarded and the deterministic composer is used
 * instead (lib/grounding/compose.ts). Pure.
 *
 *  1. Every number in the reply appears in the fact sheet. (Prices, areas,
 *     unit counts, percentages and dates are where hallucination costs most.)
 *  2. It cites only fact keys that exist, and cites at least one.
 *  3. No contact details or links — the reply must not invent a phone, email
 *     or URL, nor echo the buyer's.
 *  4. No promises the facts can't back: guaranteed returns, discounts, "best price".
 *  5. Fits the channel: non-empty and ≤ 500 characters (premium's in_app limit).
 */

export const MAX_REPLY_CHARS = 500;

const NUMBER = /\d+(?:[.,]\d+)*/g;
const normalize = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

export function factNumbers(facts: Fact[]): Set<string> {
  const numbers = new Set<string>();
  for (const fact of facts) for (const n of fact.value.match(NUMBER) ?? []) numbers.add(normalize(n));
  return numbers;
}

export interface GuardResult {
  ok: boolean;
  problems: string[];
}

export function guardReply(reply: string, citedKeys: string[], facts: Fact[]): GuardResult {
  const problems: string[] = [];
  const text = reply.trim();
  if (!text) problems.push("empty reply");
  if (text.length > MAX_REPLY_CHARS) problems.push(`longer than ${MAX_REPLY_CHARS} characters`);

  const allowed = factNumbers(facts);
  const stray = (text.match(NUMBER) ?? []).map(normalize).filter((n) => !allowed.has(n));
  if (stray.length > 0) problems.push(`numbers not in the fact sheet: ${Array.from(new Set(stray)).join(", ")}`);

  const keys = new Set(facts.map((f) => f.key));
  const unknown = citedKeys.filter((k) => !keys.has(k));
  if (unknown.length > 0) problems.push(`cites unknown facts: ${unknown.join(", ")}`);
  if (citedKeys.length === 0) problems.push("cites no facts");

  if (/https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i.test(text)) problems.push("contains a link or email");
  if (/\+?\d[\d\s-]{8,}\d/.test(text)) problems.push("contains a phone-like number");
  if (/\b(guarantee[ds]?|assured returns?|best price|discount|lowest price|risk[- ]free)\b/i.test(text)) problems.push("makes a promise the facts don't back");

  return { ok: problems.length === 0, problems };
}

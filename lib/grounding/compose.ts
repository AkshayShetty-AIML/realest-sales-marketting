import { factValue, type Fact } from "./facts";

/**
 * THE DETERMINISTIC GROUNDED REPLY — used when no LLM is configured, and as
 * the fallback whenever the LLM's draft fails the guard. Every sentence is a
 * template filled ONLY from the fact sheet; a topic the buyer asked about that
 * the facts don't cover is never answered — it is named and handed to a human.
 * Pure.
 */

export type Topic =
  | "price"
  | "rent"
  | "availability"
  | "visit"
  | "possession"
  | "amenities"
  | "legal"
  | "investment"
  | "maintenance"
  | "loan"
  | "discount"
  | "parking"
  | "floor_plan";

const TOPIC_WORDS: Record<Topic, RegExp> = {
  price: /\b(price|cost|rate|how much|budget|quote)\b/i,
  rent: /\b(rent|rental|lease)\b/i,
  availability: /\b(availab|units? left|still open|sold out|vacant)/i,
  visit: /\b(visit|site visit|see (it|the)|tour|show me|weekend|come by)\b/i,
  possession: /\b(possession|ready|handover|move in|completion)\b/i,
  amenities: /\b(amenit|gym|pool|club ?house|park|play ?area)/i,
  legal: /\b(rera|legal|litigation|approval|title)\b/i,
  investment: /\b(ticket|fraction|invest|yield|returns?)\b/i,
  maintenance: /\bmaintenance\b/i,
  loan: /\b(loan|emi|bank|finance|mortgage)\b/i,
  discount: /\b(discount|offer|negotia|best price|deal)\b/i,
  parking: /\bparking\b/i,
  floor_plan: /\b(floor ?plan|layout|carpet)\b/i,
};

/** Premium inquiry kinds imply a topic even when the text is terse. */
const KIND_TOPIC: Record<string, Topic | undefined> = {
  price: "price",
  availability: "availability",
  visit: "visit",
};

export const TOPIC_LABEL: Record<Topic, string> = {
  price: "the price",
  rent: "the rent",
  availability: "availability",
  visit: "a visit",
  possession: "possession",
  amenities: "amenities",
  legal: "RERA status",
  investment: "the investment terms",
  maintenance: "maintenance charges",
  loan: "home-loan options",
  discount: "pricing offers",
  parking: "parking",
  floor_plan: "the floor plan",
};

export function topicsOf(kind: string, message: string): Topic[] {
  const found = new Set<Topic>();
  const implied = KIND_TOPIC[kind];
  if (implied) found.add(implied);
  for (const [topic, pattern] of Object.entries(TOPIC_WORDS) as [Topic, RegExp][]) if (pattern.test(message)) found.add(topic);
  // "What's the rent" on a rent listing is a rent question, not a sale-price one.
  if (found.has("rent")) found.delete("price");
  return Array.from(found);
}

export interface Draft {
  body: string;
  factKeys: string[];
  /** Topics asked about that the facts can't answer. */
  humanTopics: Topic[];
  /** True when NOTHING asked could be answered — send a holding reply and hand off. */
  handoff: boolean;
}

function answer(topic: Topic, facts: Fact[]): { sentence: string; keys: string[] } | null {
  const v = (key: string) => factValue(facts, key);
  switch (topic) {
    case "price": {
      const price = v("sale_price");
      if (!price) return null;
      const perSqft = v("price_per_sqft");
      return { sentence: `The asking price is ${price}${perSqft ? ` (${perSqft})` : ""}.`, keys: perSqft ? ["sale_price", "price_per_sqft"] : ["sale_price"] };
    }
    case "rent":
      return v("rent") ? { sentence: `The rent is ${v("rent")}.`, keys: ["rent"] } : null;
    case "availability":
      return v("availability") ? { sentence: `Availability: ${v("availability")}.`, keys: ["availability"] } : null;
    case "possession":
      return v("possession") ? { sentence: `It is ${v("possession")}.`, keys: ["possession"] } : null;
    case "amenities":
      return v("amenities") ? { sentence: `Amenities include ${v("amenities")}.`, keys: ["amenities"] } : null;
    case "legal":
      return v("rera") ? { sentence: `RERA: ${v("rera")}.`, keys: ["rera"] } : null;
    case "investment":
      return v("min_ticket") ? { sentence: `The minimum investment in the fractional offer is ${v("min_ticket")} (a simulated offer on our platform).`, keys: ["min_ticket"] } : null;
    case "visit":
      return { sentence: "We'd be glad to arrange a site visit — a member of our team will confirm a time with you.", keys: [] };
    default:
      // maintenance, loan, discount, parking, floor plan: no fact covers them.
      return null;
  }
}

/** First name only, from the (masked) contact — "Asha D." → "Asha". Never more. */
export function greetingName(maskedName: string | null): string | null {
  const first = maskedName?.trim().split(/\s+/)[0];
  return first && /^[A-Za-z][A-Za-z'-]{1,30}$/.test(first) ? first : null;
}

export function composeReply(input: { kind: string; message: string; contactName: string | null }, facts: Fact[]): Draft {
  const name = factValue(facts, "name") ?? "the property";
  const location = factValue(facts, "location");
  const builder = factValue(facts, "builder");
  const topics = topicsOf(input.kind, input.message);
  const hello = greetingName(input.contactName);

  const sentences: string[] = [];
  const keys = new Set<string>(["name"]);
  if (location) keys.add("location");
  const humanTopics: Topic[] = [];
  for (const topic of topics) {
    const result = answer(topic, facts);
    if (result) {
      sentences.push(result.sentence);
      result.keys.forEach((k) => keys.add(k));
    } else humanTopics.push(topic);
  }

  const answered = sentences.length > 0;
  const opening = `Hi${hello ? ` ${hello}` : ""}, thanks for your interest in ${name}${location ? ` in ${location}` : ""}.`;
  const human = humanTopics.length > 0
    ? `A colleague will confirm ${humanTopics.map((t) => TOPIC_LABEL[t]).join(", ")} for you shortly.`
    : answered
      ? "Reply here if you have any other questions."
      : "A member of our team will get back to you shortly with the details.";
  if (builder) keys.add("builder");
  const signoff = `— ${builder ? `${builder} sales team` : "Sales team"} (automated reply)`;

  return {
    body: [opening, ...sentences, human, signoff].join(" "),
    factKeys: Array.from(keys),
    humanTopics,
    handoff: !answered,
  };
}

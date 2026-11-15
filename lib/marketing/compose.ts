import { factValue, type Fact } from "../grounding/facts";
import { reraLine } from "./facts";

/**
 * DETERMINISTIC GROUNDED COPY — used when no LLM key is set (labelled
 * "demo"), and whenever an LLM draft fails the guard. Every sentence is a
 * template filled ONLY from the marketing fact sheet; a missing fact drops
 * its sentence. Pure.
 */

export type GenType = "social_post" | "caption" | "ad_copy";
export const GEN_TYPES: GenType[] = ["social_post", "caption", "ad_copy"];

export const DEFAULT_CHANNEL: Record<GenType, "instagram" | "facebook" | "meta_ads"> = {
  social_post: "instagram",
  caption: "facebook",
  ad_copy: "meta_ads",
};

export interface CopyDraft {
  type: GenType;
  channel: string;
  title: string;
  body: string;
  factKeys: string[];
}

function used(facts: Fact[], keys: string[]): string[] {
  return keys.filter((k) => factValue(facts, k));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function composeCopy(type: GenType, facts: Fact[], reraRegNo: string): CopyDraft {
  const v = (k: string) => factValue(facts, k);
  const name = v("name") ?? "This project";
  const homes = v("config") ? `${v("config")} homes` : `${cap(v("type") ?? "homes")}`;
  const by = v("builder") ? ` by ${v("builder")}` : "";
  const where = v("location") ? `, ${v("location")}` : "";
  const area = v("carpet_area");
  const price = v("price");
  const possession = v("possession");
  const extras = [v("gated"), v("metro")].filter(Boolean);

  if (type === "caption") {
    const bits = [v("config"), area].filter(Boolean).join(", ");
    return {
      type,
      channel: DEFAULT_CHANNEL[type],
      title: `Caption — ${name}`,
      body: `${name}${v("locality") ? `, ${v("locality")}` : ""}${bits ? `: ${bits}.` : "."}\n${reraLine(reraRegNo)}`,
      factKeys: used(facts, ["name", "locality", "config", "carpet_area"]),
    };
  }

  if (type === "ad_copy") {
    const lines = [
      `Headline: ${name}${v("locality") ? ` — ${v("config") ? `${v("config")} in ` : ""}${v("locality")}` : ""}`,
      `Primary text: ${homes}${by}${where}.${area && !price ? ` ${cap(area)}.` : ""}${price ? ` ${cap(price)}.` : ""}${possession ? ` ${cap(possession)}.` : ""}`,
      "Call to action: Book a site visit",
      reraLine(reraRegNo),
    ];
    return {
      type,
      channel: DEFAULT_CHANNEL[type],
      title: `Ad — ${name}`,
      body: lines.join("\n"),
      factKeys: used(facts, ["name", "locality", "config", "builder", "location", "carpet_area", "price", "possession"]),
    };
  }

  const sentences = [
    `${homes} at ${name}${by}${where}.`,
    price ? `${cap(price)}.` : area ? `${cap(area)}.` : null,
    possession ? `${cap(possession)}.` : null,
    v("amenities") ? `Amenities: ${v("amenities")}.` : null,
    extras.length ? `${cap(extras.join(", "))}.` : null,
    v("availability") ? `${cap(v("availability") as string)}.` : null,
    "Register your interest to book a site visit.",
  ].filter(Boolean);
  return {
    type,
    channel: DEFAULT_CHANNEL[type],
    title: `${name}${v("config") ? ` — ${v("config")}` : ""}${v("locality") ? ` in ${v("locality")}` : ""}`,
    body: `${sentences.join(" ")}\n${reraLine(reraRegNo)}`,
    factKeys: used(facts, ["name", "builder", "location", "config", "type", "price", "carpet_area", "possession", "amenities", "gated", "metro", "availability"]),
  };
}

/** A reel storyboard from facts only — the job spec a real renderer would take. */
export function composeReel(facts: Fact[], reraRegNo: string, brand: { primaryColor: string; headingFont: string; logoUrl: string | null }, imageCount: number) {
  const v = (k: string) => factValue(facts, k);
  const name = v("name") ?? "The project";
  const scenes = [
    { visual: imageCount > 0 ? "Listing photo 1 (from the project photos)" : "Brand-colour title card", onScreenText: `${name}${v("location") ? ` · ${v("location")}` : ""}`, seconds: 3 },
    v("config") || v("carpet_area") ? { visual: imageCount > 1 ? "Listing photo 2" : "Brand-colour card", onScreenText: [v("config"), v("carpet_area")].filter(Boolean).join(" · "), seconds: 3 } : null,
    v("price") ? { visual: "Brand-colour card", onScreenText: cap(v("price") as string), seconds: 3 } : null,
    v("possession") ? { visual: imageCount > 2 ? "Listing photo 3" : "Brand-colour card", onScreenText: cap(v("possession") as string), seconds: 3 } : null,
    v("amenities") ? { visual: "Amenity photos (from the project photos, if any)", onScreenText: v("amenities") as string, seconds: 3 } : null,
    { visual: "End card: logo + RERA", onScreenText: `Book a site visit · ${reraLine(reraRegNo)}`, seconds: 3 },
  ].filter((s): s is { visual: string; onScreenText: string; seconds: number } => s !== null);
  const script = scenes.map((s, i) => `Scene ${i + 1} (${s.seconds}s) — ${s.visual}: "${s.onScreenText}"`).join("\n");
  return {
    title: `Reel — ${name}`,
    script: `${script}\n${reraLine(reraRegNo)}`,
    spec: { aspect: "9:16", durationSec: scenes.reduce((n, s) => n + s.seconds, 0), scenes, brand, label: "AI-generated reel (demo — not rendered yet)" },
    factKeys: used(facts, ["name", "location", "config", "carpet_area", "price", "possession", "amenities"]),
  };
}

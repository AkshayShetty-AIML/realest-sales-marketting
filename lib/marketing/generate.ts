import "server-only";
import { z } from "zod";
import { completeJson, NO_LLM } from "../llm";
import { premium } from "../premium/client";
import { marketing } from "../premium/marketing-client";
import type { BrandKit } from "../premium/marketing-contract";
import type { Property } from "../premium/contract";
import { buildMarketingFacts, type MarketingFacts } from "./facts";
import { composeCopy, composeReel, GEN_TYPES, type CopyDraft, type GenType } from "./compose";
import { guardCopy, withReraLine } from "./guard";

/**
 * GROUNDED MARKETING GENERATION. Facts come from the spine
 * (GET /properties/:id), the brand from GET /marketing/brand-kit. With
 * GROQ_API_KEY the model writes in the kit's tone from the FACTS only; every
 * draft must pass lib/marketing/guard.ts or it is replaced by the
 * deterministic template. Without a key, the template writes it and the
 * asset is labelled "demo". SERVER ONLY.
 */

export const AI_LABEL = { llm: "AI-generated", template: "AI-generated (demo template)" } as const;

export interface GeneratedDraft extends CopyDraft {
  engine: "llm" | "template";
  aiLabel: string;
  fallbackReason: string | null;
}

export interface Generation {
  property: Pick<Property, "id" | "name" | "builder" | "locality" | "city">;
  kit: BrandKit | null;
  grounding: MarketingFacts;
  drafts: GeneratedDraft[];
}

export class GenerationBlocked extends Error {}

export async function loadGrounding(propertyId: string) {
  const [property, kit] = await Promise.all([premium.getProperty(propertyId), marketing.getBrandKit()]);
  return { property, kit, grounding: buildMarketingFacts(property, kit) };
}

const ModelOutput = z.object({
  assets: z.array(z.object({ type: z.enum(["social_post", "caption", "ad_copy"]), title: z.string(), body: z.string(), factKeysUsed: z.array(z.string()) })),
});

const SYSTEM = `You write real-estate MARKETING copy for one builder, in India, under RERA advertising rules.
Rules — breaking any makes the copy unusable:
- Use ONLY the facts in FACTS. Never state a number, price, date, area, amenity, distance or claim not in FACTS. If a fact is missing, leave the topic out.
- Areas and prices only as given in FACTS (carpet area). Never mention super built-up area.
- No superlatives or promises: no "best", "No. 1", "lowest", "luxury", "world-class", "guaranteed", "assured", returns, yield, appreciation, discounts, or urgency ("hurry", "limited period", "last few").
- No phone numbers, emails, links or hashtags with numbers.
- Write in the TONE given. Plain, warm, factual.
- Do not add the RERA line; it is appended for you.
Formats: social_post ≤ 600 chars (Instagram); caption ≤ 220 chars (Facebook); ad_copy as three lines "Headline: …", "Primary text: …", "Call to action: …" ≤ 450 chars.
Respond as JSON: {"assets":[{"type","title","body","factKeysUsed":[keys from FACTS]}]} with one asset per requested type.`;

/** Generate copy for the given types. Throws GenerationBlocked when there is no RERA reg no. */
export async function generateCopy(propertyId: string, types: GenType[] = GEN_TYPES): Promise<Generation> {
  const { property, kit, grounding } = await loadGrounding(propertyId);
  const summary = { id: property.id, name: property.name, builder: property.builder, locality: property.locality, city: property.city };
  return { property: summary, kit, grounding, drafts: await generateDrafts(summary.name, kit, grounding, types) };
}

/**
 * The drafting itself, from an already-loaded grounding (the spine's record
 * here; a workspace's company memory in the marketing harness —
 * lib/marketing/agents). Model in the kit's tone from the FACTS only, each
 * draft guarded, template fallback. Throws GenerationBlocked without a RERA no.
 */
export async function generateDrafts(projectName: string, kit: BrandKit | null, grounding: MarketingFacts, types: GenType[] = GEN_TYPES): Promise<GeneratedDraft[]> {
  const rera = grounding.reraRegNo;
  if (!rera) throw new GenerationBlocked("Set the RERA registration number in Brand settings before generating — every asset must carry it.");
  const facts = grounding.facts;
  const template = (type: GenType, reason: string | null): GeneratedDraft => ({ ...composeCopy(type, facts, rera), engine: "template", aiLabel: AI_LABEL.template, fallbackReason: reason });

  const result = await completeJson({
    feature: "content-studio",
    schema: ModelOutput,
    system: SYSTEM,
    temperature: 0.4,
    maxTokens: 900,
    timeoutMs: 15_000,
    context: { FACTS: Object.fromEntries(facts.map((f) => [f.key, `${f.label}: ${f.value}`])) },
    prompt: { TONE: kit?.toneOfVoice || "warm, plain, factual", TYPES: types },
  });
  if (!result.ok && result.reason === NO_LLM) return types.map((t) => template(t, `${NO_LLM} (demo)`));
  const modelAssets = result.ok ? result.data.assets : [];
  const modelError = result.ok ? null : result.reason;

  const keys = new Set(facts.map((f) => f.key));
  return types.map((type): GeneratedDraft => {
    const m = modelAssets.find((a) => a.type === type);
    if (!m) return template(type, modelError ?? "model skipped this format");
    const body = withReraLine(m.body, rera);
    const verdict = guardCopy(body, facts, rera, type);
    const cited = m.factKeysUsed.filter((k) => keys.has(k));
    if (!verdict.ok || cited.length === 0) return template(type, `guard: ${verdict.ok ? "cites no facts" : verdict.problems.join("; ")}`);
    return { type, channel: composeCopy(type, facts, rera).channel, title: m.title.slice(0, 160) || projectName, body, factKeys: cited, engine: "llm", aiLabel: AI_LABEL.llm, fallbackReason: null };
  });
}

const HeroOutput = z.object({ subhead: z.string(), factKeysUsed: z.array(z.string()) });

const HERO_SYSTEM = `You write the one-line strapline under the headline of a real-estate project's landing page, for one builder in India, under RERA advertising rules.
Rules — breaking any makes it unusable:
- Use ONLY the facts in FACTS. Never state a number, price, date, area, amenity, distance or claim not in FACTS. Prefer no numbers at all.
- No superlatives or promises: no "best", "No. 1", "lowest", "luxury", "world-class", "guaranteed", "assured", returns, yield, appreciation, discounts, or urgency.
- No phone numbers, emails, links, hashtags or emoji. Plain text only.
- One sentence, under 140 characters, in the TONE given. It must mention the locality.
Respond as JSON: {"subhead": string, "factKeysUsed": [keys from FACTS]}.`;

/**
 * LANDING PAGE HERO LINE. The page itself is composed deterministically
 * (lib/marketing/landing.ts); with GROQ_API_KEY the model may rewrite ONLY the
 * strapline under the headline, from the FACTS, in the kit's tone. It must
 * pass the same claims guard as studio copy and cite real fact keys, or the
 * composed line stays. The page is still saved as a draft and goes through
 * approval + the RERA gate like any other asset.
 */
export async function writeLandingHeroLine(grounding: MarketingFacts, kit: BrandKit | null, fallback: string | null): Promise<{ subhead: string | null; engine: "llm" | "template"; fallbackReason: string | null }> {
  const rera = grounding.reraRegNo;
  if (!rera) return { subhead: fallback, engine: "template", fallbackReason: "no RERA reg no." };
  const facts = grounding.facts;
  const result = await completeJson({
    feature: "landing-hero",
    schema: HeroOutput,
    system: HERO_SYSTEM,
    temperature: 0.4,
    maxTokens: 200,
    context: { FACTS: Object.fromEntries(facts.map((f) => [f.key, `${f.label}: ${f.value}`])) },
    prompt: { TONE: kit?.toneOfVoice || "warm, plain, factual" },
  });
  if (!result.ok) return { subhead: fallback, engine: "template", fallbackReason: result.reason };
  const line = result.data.subhead.replace(/\s+/g, " ").trim();
  const keys = new Set(facts.map((f) => f.key));
  const verdict = guardCopy(withReraLine(line, rera), facts, rera, "caption");
  if (!verdict.ok || line.length > 160 || !result.data.factKeysUsed.some((k) => keys.has(k))) {
    return { subhead: fallback, engine: "template", fallbackReason: `guard: ${verdict.ok ? "cites no facts or too long" : verdict.problems.join("; ")}` };
  }
  return { subhead: line, engine: "llm", fallbackReason: null };
}

/** The reel's storyboard + job spec (template — a real renderer is a production step). */
export async function storyboardReel(propertyId: string) {
  const { property, kit, grounding } = await loadGrounding(propertyId);
  if (!grounding.reraRegNo) throw new GenerationBlocked("Set the RERA registration number in Brand settings before generating — every asset must carry it.");
  const images = Array.isArray((property as { images?: unknown[] }).images) ? ((property as { images?: unknown[] }).images as unknown[]).length : 0;
  const reel = composeReel(grounding.facts, grounding.reraRegNo, { primaryColor: kit?.primaryColor ?? "#0f6b46", headingFont: kit?.headingFont ?? "Playfair Display", logoUrl: kit?.logoUrl ?? null }, images);
  return { property, grounding, reel };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import { marketing, type CaptureInput } from "../premium/marketing-client";
import type { Attribution, BrandKit, LandingPage, Magnet, QuizAnswers } from "../premium/marketing-contract";
import type { Property } from "../premium/contract";
import type { MarketingFacts } from "./facts";
import { generateBrochure } from "../brochure/generate";
import { mintBrochureLink } from "../links";
import { inr, shortDate } from "../grounding/facts";
import { audit } from "../store";
import { loadGrounding, GenerationBlocked, writeLandingHeroLine } from "./generate";
import { composeLanding, landingSlug, loanEligibility, type LandingContent } from "./landing";
import { buildMarketingFacts, carpetSqft } from "./facts";

/**
 * LANDING PAGES + LEAD CAPTURE. A page is generated from the spine record and
 * saved as a draft (POST /marketing/landing-pages). A capture on it creates
 * ONE lead on the SHARED leads table through POST /marketing/leads — the same
 * row the sales desk inbox lists — carrying campaign_id, source, utm and the
 * consent the buyer gave. Then the chosen lead magnet is fulfilled.
 */

/**
 * Makes a project page for a REAL building. The page record stores only the
 * COPY humans own — the headline and a strapline (AI-written only when it
 * passes the claims guard, labelled) — never facts: every fact, price and
 * unit is read live from the shared inventory when the page renders
 * (lib/marketing/project-page.ts). The RERA number used is the BUILDING's own
 * (from the listing), or the brand kit's only when the kit is that builder's.
 */
export async function generateLandingPage(propertyId: string, actor: string, campaignId?: string): Promise<LandingPage> {
  const { property, kit } = await loadGrounding(propertyId);
  const ownRera = typeof (property as { reraNumber?: unknown }).reraNumber === "string" ? String((property as { reraNumber?: string }).reraNumber) : null;
  const kitIsTheirs = !!kit?.builderName && kit.builderName.trim().toLowerCase() === property.builder.trim().toLowerCase();
  const rera = ownRera ?? (kitIsTheirs ? kit?.defaultReraRegNo ?? null : null);
  const grounding = buildMarketingFacts(property, kit ? { ...kit, defaultReraRegNo: rera } : ({ defaultReraRegNo: rera } as BrandKit));
  const headline = `${property.config ? `${property.config} homes at ` : ""}${property.name}`;
  const fallback = [`${property.locality}, ${property.city}`, property.builder ? `by ${property.builder}` : null].filter(Boolean).join(" · ");
  const hero = rera ? await writeLandingHeroLine(grounding, kitIsTheirs ? kit : null, fallback) : { subhead: fallback, engine: "template" as const, fallbackReason: "no RERA registration for this building" };
  const content = { version: 2, engine: hero.engine, label: hero.engine === "llm" ? "AI-written strapline, checked against the listing's facts" : "Copy from the listing", hero: { headline, subhead: hero.subhead }, magnets: ["brochure", "price_list", "eligibility", "register_interest"] };
  const page = await marketing.createLandingPage({
    slug: landingSlug(property.id, randomUUID().slice(0, 6)),
    title: `${property.name}${property.config ? ` — ${property.config}` : ""}`,
    content,
    propertyId: property.id,
    campaignId,
    reraRegNo: rera ?? undefined,
    aiGenerated: hero.engine === "llm",
    createdBy: actor,
  });
  await audit("marketing-landing-drafted", null, actor, `landing page /${page.slug} for ${property.name} saved as ${page.status}${hero.engine === "llm" ? " (AI strapline)" : hero.fallbackReason ? ` (composed strapline: ${hero.fallbackReason})` : ""}`);
  return page;
}

/**
 * The page content: composed deterministically from the record, with the
 * strapline optionally AI-written (guarded). Shared by the console and the
 * marketing harness (lib/marketing/agents). Throws GenerationBlocked without a RERA no.
 */
export async function composeLandingContent(property: Property, kit: BrandKit | null, grounding: MarketingFacts) {
  if (!grounding.reraRegNo) throw new GenerationBlocked("Set the RERA registration number in Brand settings first — the page must show it.");
  const composed = composeLanding(property, kit, grounding);
  const hero = await writeLandingHeroLine(grounding, kit, composed.hero.subhead);
  const content: LandingContent =
    hero.engine === "llm"
      ? { ...composed, engine: "llm", label: "Generated from verified platform data (AI-written strapline, passed the claims guard)", hero: { ...composed.hero, subhead: hero.subhead } }
      : composed;
  return { content, hero };
}

export const landingContent = (page: LandingPage) => page.content as unknown as LandingContent;

export interface PriceList {
  property: string;
  config: string | null;
  carpetArea: string | null;
  rows: { unitId: string; price: string | null; lastVerifiedAt: string }[];
  note: string;
}

/** Available units and their prices from live inventory, with when each was last verified. */
export async function priceList(propertyId: string): Promise<PriceList> {
  const [property, units] = await Promise.all([premium.getProperty(propertyId), premium.listInventory({ projectId: propertyId, status: "available" })]);
  const carpet = carpetSqft(property);
  return {
    property: property.name,
    config: property.config ?? null,
    carpetArea: carpet ? `${carpet.toLocaleString("en-IN")} sq ft carpet area` : null,
    rows: units.map((u) => ({ unitId: u.unitId, price: u.price !== null ? inr(u.price) : null, lastVerifiedAt: shortDate(u.lastVerifiedAt) })),
    note: carpet ? `Prices are for the ${property.config ?? "listed"} layout, ${carpet.toLocaleString("en-IN")} sq ft carpet area, from verified inventory.` : "Carpet area for each unit is confirmed by the sales team.",
  };
}

export type MagnetResult =
  | { magnet: "brochure"; url: string }
  | { magnet: "price_list"; list: PriceList }
  | { magnet: "eligibility"; result: ReturnType<typeof loanEligibility> | null }
  | { magnet: "register_interest" };

export interface CaptureRequest {
  page: LandingPage;
  magnet: Magnet;
  contact: CaptureInput["contact"];
  consent: CaptureInput["consent"];
  utm?: CaptureInput["utm"];
  source?: string;
  answers?: QuizAnswers;
  eligibility?: { monthlyIncome: number; existingEmis: number };
  /** The unit of interest on the page's building (tagged on the lead by premium). */
  unitId?: string;
}

/** The capture: one lead on the shared table, then the magnet. */
export async function captureLead(req: CaptureRequest): Promise<{ lead: Attribution; result: MagnetResult }> {
  const lead = await marketing.captureLead({
    landingPageId: req.page.id,
    magnet: req.magnet,
    source: req.source ?? "landing_page",
    contact: req.contact,
    consent: req.consent,
    utm: req.utm,
    answers: req.answers,
    unitId: req.unitId,
  });
  await audit("marketing-lead-captured", lead.leadId, "lead-capture", `${req.magnet} on /${req.page.slug}${lead.campaignName ? ` · campaign ${lead.campaignName}` : ""} · source ${lead.source}`);
  let result: MagnetResult;
  if (req.magnet === "brochure") {
    const brochure = await generateBrochure(lead.leadId, "lead-capture");
    result = { magnet: "brochure", url: await mintBrochureLink(lead.leadId, brochure.id) };
  } else if (req.magnet === "price_list") {
    result = { magnet: "price_list", list: await priceList(lead.propertyId) };
  } else if (req.magnet === "eligibility") {
    result = { magnet: "eligibility", result: req.eligibility ? loanEligibility(req.eligibility.monthlyIncome, req.eligibility.existingEmis) : null };
  } else {
    result = { magnet: "register_interest" };
  }
  return { lead, result };
}

export const CONSENT_TEXT =
  "I agree to be contacted about this project by the builder's team on the channels I've ticked. I can opt out at any time by replying STOP or asking the team.";

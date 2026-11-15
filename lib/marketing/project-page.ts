import "server-only";
import { premiumConfig } from "../env";
import { premium } from "../premium/client";
import { marketing } from "../premium/marketing-client";
import type { Building, Property, Unit } from "../premium/contract";
import type { BrandKit, LandingPage } from "../premium/marketing-contract";
import { harness, type Workspace } from "./harness";
import { covers, sameBuilder } from "./agents/catalogue";
import type { LandingContent } from "./landing";

/**
 * A PROJECT PAGE = one REAL building from the shared inventory, read LIVE from
 * premium's internal API on every request (the one source): the listing
 * (name, builder, location, possession, amenities, media + provenance, RERA),
 * the building's layout, and its units (availability available / held / sold,
 * the `indicative` flag, per-field provenance). Nothing is typed in or stored
 * here; mark a unit sold in premium and the page shows it on the next view.
 *
 * The page RECORD (premium landing_pages) contributes only what humans own:
 * the approved headline + strapline (AI-written straplines carry their label).
 *
 * BRAND: the brand kit of the building's builder — the marketing workspace
 * that receives this building (its company-memory brand kit), else the
 * spine's kit when it is that builder's, else a neutral house style that
 * names the builder. Never another builder's brand.
 */

export interface PageUnit {
  id: string;
  unitNo: string | null;
  label: string;
  floor: number | null;
  config: string | null;
  facing: string | null;
  /** "estimate" etc. when the source says so. */
  facingNote: string | null;
  carpetSqft: number | null;
  superBuiltUpSqft: number | null;
  price: number | null;
  availability: "available" | "held" | "sold";
  /** A layout placeholder: illustrative status, no facts. */
  indicative: boolean;
  provenance: string;
  lastVerifiedAt: string;
}

export interface PageMedia {
  url: string;
  caption: string;
  /** What the viewer is told this image is. */
  label: string;
  placeholder: boolean;
}

export interface ProjectPageModel {
  page: Pick<LandingPage, "id" | "slug" | "title" | "status" | "campaignId">;
  copy: { headline: string; subhead: string | null; aiLabel: string | null };
  brand: { builderName: string; logoUrl: string | null; primary: string; secondary: string; headingFont: string; bodyFont: string; source: "workspace" | "spine" | "house" };
  property: { id: string; name: string; builder: string; locality: string; city: string; address: string | null; coords: { lat: number; lng: number } | null; possession: string; constructionPct: number | null; architect: string | null; developerNote: string | null; verified: boolean; grade: string | null; listedPrice: number | null; config: string | null };
  rera: { number: string | null; status: string };
  building: Building | null;
  units: PageUnit[];
  /**
   * Counts are of CONFIRMED units only: an indicative unit's status is illustrative, so it is never
   * counted as available / held / sold — it is reported separately as `indicative`.
   */
  summary: { total: number; available: number; held: number; sold: number; indicative: number; configs: string[]; priceMin: number | null; priceMax: number | null; carpetMin: number | null; carpetMax: number | null; lastVerifiedAt: string | null };
  media: PageMedia[];
  amenities: { name: string; detail: string | null; planned: boolean }[];
  landmarks: { name: string; km: number | null }[];
  notes: string[];
}

const PLACEHOLDER = /picsum\.photos|placehold|unsplash\.it/i;
const IMAGE = /\.(jpe?g|png|webp|avif)(\?|$)/i;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Where premium serves its media ("/listings/…" paths are relative to the premium site). */
function siteBase(): string {
  return (premiumConfig()?.apiBase ?? "").replace(/\/api\/internal$/, "");
}

function mediaOf(p: Record<string, unknown>): PageMedia[] {
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${siteBase()}${u.startsWith("/") ? "" : "/"}${u}`);
  const items = Array.isArray(p.media) ? (p.media as Record<string, unknown>[]) : [];
  const fromMedia = items
    // Images only (a 3D walkthrough / video / document is not a picture).
    .filter((m) => typeof m.url === "string" && (IMAGE.test(String(m.url)) || PLACEHOLDER.test(String(m.url))))
    .map((m) => {
      const url = String(m.url);
      const placeholder = PLACEHOLDER.test(url);
      const prov = (m.provenance as { note?: string } | undefined)?.note ?? null;
      const label = placeholder ? "Placeholder photo (demo) — not the actual project" : m.imageKind === "render" ? "Developer's render — an artist's impression" : prov ?? "Listing photo";
      return { url: abs(url), caption: str(m.caption) ?? str(m.room) ?? "", label, placeholder };
    });
  if (fromMedia.length) return fromMedia;
  return (Array.isArray(p.images) ? (p.images as unknown[]) : [])
    .filter((u): u is string => typeof u === "string")
    .map((u) => ({ url: abs(u), caption: "", label: PLACEHOLDER.test(u) ? "Placeholder photo (demo) — not the actual project" : "Listing photo", placeholder: PLACEHOLDER.test(u) }));
}

/** The building's builder's brand kit: its workspace's (company memory), else the spine's if it is theirs, else a house style. */
async function brandFor(property: Property): Promise<ProjectPageModel["brand"]> {
  const house = { builderName: property.builder, logoUrl: null, primary: "#23282d", secondary: "#a88a5b", headingFont: "Playfair Display", bodyFont: "Inter", source: "house" as const };
  const ws = (await harness().store.listWorkspaces()).find((w) => covers(w, property));
  if (ws) {
    const kit = await harness().memory(ws.id).get("brand_kit", "main");
    const d = kit?.data ?? {};
    if (kit && (!str(d.builderName) || sameBuilder(String(d.builderName), property.builder))) {
      return { builderName: str(d.builderName) ?? property.builder, logoUrl: str(d.logoUrl), primary: str(d.primaryColor) ?? house.primary, secondary: str(d.secondaryColor) ?? house.secondary, headingFont: str(d.headingFont) ?? house.headingFont, bodyFont: str(d.bodyFont) ?? house.bodyFont, source: "workspace" };
    }
  }
  const spine: BrandKit | null = await marketing.getBrandKit().catch(() => null);
  if (spine && sameBuilder(spine.builderName, property.builder)) {
    return { builderName: spine.builderName ?? property.builder, logoUrl: spine.logoUrl, primary: spine.primaryColor, secondary: spine.secondaryColor, headingFont: spine.headingFont, bodyFont: spine.bodyFont, source: "spine" };
  }
  return house;
}

const RERA_STATUS: Record<string, string> = {
  "on-time": "RERA-registered · on schedule",
  delayed: "RERA-registered · currently behind schedule",
  "not-applicable": "RERA doesn't apply (owner-listed resale)",
};

export async function loadProjectPage(page: LandingPage): Promise<ProjectPageModel | null> {
  if (!page.propertyId) return null;
  const [property, units, buildings] = await Promise.all([
    premium.getProperty(page.propertyId).catch(() => null),
    premium.listInventory({ buildingId: page.propertyId, limit: 500 }).catch(() => [] as Unit[]),
    premium.listBuildings().catch(() => [] as Building[]),
  ]);
  if (!property) return null;
  const p = property as Record<string, unknown>;
  const content = page.content as unknown as Partial<LandingContent>;
  const pageUnits: PageUnit[] = units
    .map((u) => ({
      id: u.unitId,
      unitNo: u.unitNo ?? null,
      label: u.label ?? u.unitId,
      floor: u.floor ?? null,
      config: u.config ?? null,
      facing: u.facing ?? null,
      facingNote: u.fieldStatus?.facing ?? null,
      carpetSqft: u.carpetSqft ?? null,
      superBuiltUpSqft: u.superBuiltUpSqft ?? null,
      price: u.price,
      availability: u.availability ?? (u.status === "blocked" ? "held" : u.status),
      indicative: u.indicative ?? false,
      provenance: u.provenance ?? "owner_stated",
      lastVerifiedAt: u.lastVerifiedAt,
    }))
    .sort((a, b) => (b.floor ?? 0) - (a.floor ?? 0) || String(a.unitNo ?? a.id).localeCompare(String(b.unitNo ?? b.id)));
  // Ranges only from REAL units (an indicative unit states no price / area).
  const real = pageUnits.filter((u) => !u.indicative);
  const range = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [null, null];
  };
  const [priceMin, priceMax] = range(real.map((u) => u.price));
  const [carpetMin, carpetMax] = range(real.map((u) => u.carpetSqft));
  const count = (s: PageUnit["availability"]) => real.filter((u) => u.availability === s).length;
  const address = p.address as { line?: string } | undefined;
  const stated = Array.isArray(p.statedAmenities) ? (p.statedAmenities as { name: string; detail: string | null }[]) : [];
  const amenities = stated.length
    ? stated.map((a) => ({ name: a.name, detail: a.detail ?? null, planned: false }))
    : (property.amenities ?? []).map((a) => ({ name: a.name ?? a.kind.replace(/-/g, " "), detail: null, planned: a.condition === "planned" }));
  const brand = await brandFor(property);
  const reraNumber = str(p.reraNumber) ?? null;
  const notes: string[] = [];
  if (!property.verified) notes.push("This listing's details haven't been independently verified yet.");
  const building = buildings.find((b) => b.id === property.id) ?? null;
  if (building?.layoutStatus === "indicative" && building.layoutNote) notes.push(building.layoutNote);
  return {
    page: { id: page.id, slug: page.slug, title: page.title, status: page.status, campaignId: page.campaignId },
    copy: {
      headline: str(content.hero?.headline) ?? property.name,
      subhead: str(content.hero?.subhead),
      aiLabel: content.engine === "llm" ? "Strapline written with AI and checked against the listing's facts" : null,
    },
    brand,
    property: {
      id: property.id,
      name: property.name,
      builder: property.builder,
      locality: property.locality,
      city: property.city,
      address: str(address?.line),
      coords: property.coords ?? null,
      possession: property.possession === "ready" ? "Ready to move in" : `Under construction${num(property.constructionPct) !== null ? ` · ${property.constructionPct}% built` : ""}`,
      constructionPct: num(property.constructionPct),
      architect: str(p.architect),
      developerNote: str(p.developerNote),
      verified: property.verified,
      grade: property.grade && !/not graded/i.test(property.grade) ? property.grade : null,
      listedPrice: property.salePrice,
      config: property.config ?? null,
    },
    rera: { number: reraNumber, status: RERA_STATUS[property.trust.rera] ?? (reraNumber ? "RERA-registered" : "RERA registration not on record") },
    building,
    units: pageUnits,
    summary: {
      total: real.length,
      available: count("available"),
      held: count("held"),
      sold: count("sold"),
      indicative: pageUnits.filter((u) => u.indicative).length,
      configs: Array.from(new Set(real.map((u) => u.config).filter((c): c is string => Boolean(c)).concat(property.config ? [property.config] : []))),
      priceMin,
      priceMax,
      carpetMin,
      carpetMax,
      lastVerifiedAt: pageUnits.map((u) => u.lastVerifiedAt).sort().at(-1) ?? null,
    },
    media: mediaOf(p),
    amenities,
    landmarks: (Array.isArray(p.landmarks) ? (p.landmarks as { name: string; km?: number }[]) : []).slice(0, 8).map((l) => ({ name: l.name, km: num(l.km) })),
    notes,
  };
}

/** The buildings an operator may make pages for: those their workspaces receive (builder link or connected building). */
export async function buildingsFor(operatorWorkspaces: Workspace[]): Promise<Property[]> {
  if (operatorWorkspaces.length === 0) return [];
  const ids = Array.from(new Set((await premium.listBuildings()).map((b) => b.id)));
  const props = (await Promise.all(ids.map((id) => premium.getProperty(id).catch(() => null)))).filter((p): p is Property => p !== null);
  return props.filter((p) => operatorWorkspaces.some((w) => covers(w, p)));
}

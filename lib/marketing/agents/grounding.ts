import "server-only";
import { marketing } from "../../premium/marketing-client";
import type { Property } from "../../premium/contract";
import type { BrandKit } from "../../premium/marketing-contract";
import { buildMarketingFacts, type MarketingFacts } from "../facts";
import type { ToolContext, Workspace } from "../harness/types";
import { catalogue, covers, sameBuilder, workspaceProperties } from "./catalogue";

/**
 * WORKSPACE GROUNDING for the marketing harness tools — ONE SOURCE OF TRUTH.
 *
 *  - buildings + units  ONLY from the premium inventory (./catalogue.ts),
 *                       limited to the workspace's linked builder
 *                       (workspace.builderId). No copies: a "project" in
 *                       company memory is at most a POINTER ({ propertyId });
 *                       facts typed into memory are never read.
 *  - brand kit          company memory brand_kit "main" (marketing knowledge,
 *                       not inventory); else the spine's kit when it is this
 *                       builder's.
 *
 * The fact sheet is then built by the existing lib/marketing/facts.ts rules
 * (carpet area only, price only with carpet area, no claims) — unchanged.
 */

export class NotGrounded extends Error {}

/** Linked to a premium builder → its inventory and leads are readable. */
export const linkedToSpine = (ctx: { workspace: Pick<Workspace, "builderId" | "projects"> }): boolean => Boolean(ctx.workspace.builderId || ctx.workspace.projects?.length);

const str = (v: unknown, fallback: string | null = null) => (typeof v === "string" && v.trim() ? v.trim() : fallback);

export async function brandKitFor(ctx: Pick<ToolContext, "memory" | "workspace">): Promise<{ kit: BrandKit | null; source: "memory" | "premium" | null }> {
  const item = await ctx.memory.get("brand_kit", "main");
  if (item) {
    const d = item.data;
    return {
      source: "memory",
      kit: {
        builderName: str(d.builderName),
        logoPath: null,
        logoUrl: str(d.logoUrl),
        primaryColor: str(d.primaryColor, "#0f6b46")!,
        secondaryColor: str(d.secondaryColor, "#b7791f")!,
        headingFont: str(d.headingFont, "Playfair Display")!,
        bodyFont: str(d.bodyFont, "Inter")!,
        toneOfVoice: str(d.toneOfVoice, "warm, plain, factual")!,
        defaultReraRegNo: str(d.defaultReraRegNo) ?? str(d.reraRegNo),
        updatedBy: item.source,
        updatedAt: item.updatedAt,
      },
    };
  }
  if (linkedToSpine(ctx)) {
    const kit = await marketing.getBrandKit().catch(() => null);
    if (kit && sameBuilder(kit.builderName, ctx.workspace.builderId)) return { kit, source: "premium" };
  }
  return { kit: null, source: null };
}

export interface Grounded {
  property: Property;
  kit: BrandKit | null;
  grounding: MarketingFacts;
  source: "premium";
}

/**
 * The premium property id a reference points at. A real premium building ALWAYS wins — a legacy memory item that
 * happens to share its id (e.g. an old typed-in "cedar-heights") can never shadow it. Otherwise a memory pointer.
 */
async function propertyIdFor(ctx: Pick<ToolContext, "memory">, ref: string): Promise<string> {
  if (await catalogue().getProperty(ref).then(() => true, () => false)) return ref;
  const pointer = await ctx.memory.get("project", ref);
  if (!pointer) return ref;
  const id = str(pointer.data.propertyId);
  if (!id) throw new NotGrounded(`"${pointer.title}" in company memory is a legacy copy with typed-in facts, not a premium building — the agents no longer read it. Use a building from the premium inventory.`);
  return id;
}

/** Grounds one of THIS workspace's builder's buildings, read live from the premium inventory. */
export async function groundProject(ctx: ToolContext, ref: string): Promise<Grounded> {
  if (!linkedToSpine(ctx)) throw new NotGrounded("This workspace isn't linked to a builder in the premium inventory yet (Agent Harness → Settings), so it has no buildings to work on.");
  const id = await propertyIdFor(ctx, ref);
  const property = await catalogue()
    .getProperty(id)
    .catch(() => null);
  if (!property || !covers(ctx.workspace, property)) throw new NotGrounded(`"${id}" isn't one of ${ctx.workspace.builderId ?? "this workspace"}'s buildings in the premium inventory.`);
  const { kit } = await brandKitFor(ctx);
  return { property, kit, grounding: buildMarketingFacts(property, kit), source: "premium" };
}

/**
 * The building a task is about, from the workspace builder's premium inventory:
 * an explicit id/pointer, else the building named in the text — never a guess.
 */
export async function resolveProjectKey(ctx: Pick<ToolContext, "memory" | "workspace">, text: string, explicit?: unknown): Promise<string | null> {
  if (!linkedToSpine(ctx)) return null;
  const buildings = await workspaceProperties(ctx.workspace);
  if (typeof explicit === "string") {
    const id = await propertyIdFor(ctx, explicit).catch(() => null);
    if (id && buildings.some((b) => b.id === id)) return id;
  }
  const lower = text.toLowerCase();
  const named = buildings.find((b) => lower.includes(b.name.toLowerCase()) || lower.includes(b.id.toLowerCase()));
  // No silent fallback to "the only building": a mission about a building this builder doesn't have must block, not
  // quietly draft about a different one.
  return named?.id ?? null;
}

import "server-only";
import { marketing, type BrandKitInput } from "../premium/marketing-client";
import { LOGO_TYPES, MAX_LOGO_BYTES } from "../premium/marketing-contract";
import { audit } from "../store";
import { loadGrounding, storyboardReel, AI_LABEL, GenerationBlocked } from "./generate";
import { guardCopy, withReraLine } from "./guard";
import type { GenType } from "./compose";

/**
 * Marketing operations (brand kit, content drafts, reels) — called by the
 * marketing server actions and by scripts/verify-marketing.ts, so the verify
 * run exercises exactly what the console does. Every write goes to the spine
 * through /api/internal/marketing/*; every create is a draft.
 */

export class CopyRejected extends Error {
  constructor(readonly problems: string[]) {
    super(`Not saved — ${problems.join("; ")}.`);
  }
}

export { GenerationBlocked };

export async function saveKit(input: BrandKitInput, actor: string) {
  const kit = await marketing.saveBrandKit({ ...input, updatedBy: actor });
  await audit("marketing-brand-kit-saved", null, actor, `brand kit saved (${Object.keys(input).join(", ")})`);
  return kit;
}

/** Upload a logo through a spine-signed URL (no storage key here), then point the kit at it. */
export async function uploadLogo(file: { type: string; size: number; bytes: ArrayBuffer }, actor: string) {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new Error("Logo must be PNG, JPEG or WebP.");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Logo must be under 2 MB.");
  const signed = await marketing.signLogoUpload({ contentType: file.type, bytes: file.size });
  const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file.bytes, signal: AbortSignal.timeout(20_000) });
  if (!put.ok) throw new Error(`Logo upload failed (${put.status}).`);
  return saveKit({ logoPath: signed.path }, actor);
}

export interface DraftInput {
  propertyId: string;
  campaignId?: string;
  type: GenType;
  channel: string;
  title: string;
  body: string;
  factKeys: string[];
  engine: "llm" | "template";
  /** True when the operator changed the generated text. */
  edited: boolean;
}

/**
 * Saves a (possibly edited) generated draft. The guard runs again on the
 * final text — an edit can't slip an invented number or claim past it — and
 * the RERA line is re-attached if an edit removed it.
 */
export async function saveDraft(input: DraftInput, actor: string) {
  const { grounding } = await loadGrounding(input.propertyId);
  if (!grounding.reraRegNo) throw new GenerationBlocked("Set the RERA registration number in Brand settings first.");
  const body = withReraLine(input.body, grounding.reraRegNo);
  const verdict = guardCopy(body, grounding.facts, grounding.reraRegNo, input.type);
  if (!verdict.ok) throw new CopyRejected(verdict.problems);
  const known = new Set(grounding.facts.map((f) => f.key));
  const asset = await marketing.createContent({
    type: input.type,
    channel: input.channel as never,
    title: input.title.trim().slice(0, 160) || "Untitled",
    body,
    propertyId: input.propertyId,
    campaignId: input.campaignId || undefined,
    reraRegNo: grounding.reraRegNo,
    aiGenerated: true,
    aiLabel: input.edited ? `${AI_LABEL[input.engine]} · edited` : AI_LABEL[input.engine],
    engine: input.engine,
    factKeys: input.factKeys.filter((k) => known.has(k)),
    createdBy: actor,
  });
  await audit("marketing-content-drafted", null, actor, `${asset.type} "${asset.title}" saved as draft (${asset.id})`);
  return asset;
}

/** Queues a reel: video asset (draft) + media job + media-library entry, all "processing (demo)". */
export async function queueReel(propertyId: string, actor: string, campaignId?: string) {
  const { property, reel, grounding } = await storyboardReel(propertyId);
  const result = await marketing.createReel({
    propertyId: property.id,
    campaignId,
    title: reel.title,
    script: reel.script,
    spec: reel.spec,
    reraRegNo: grounding.reraRegNo ?? undefined,
    aiLabel: "AI-generated reel (demo) · processing",
    engine: "template",
    factKeys: reel.factKeys,
    createdBy: actor,
  });
  await audit("marketing-reel-queued", null, actor, `reel queued for ${property.name} (job ${result.job.id})`);
  return result;
}

import "server-only";
import { premium, PremiumError } from "./premium/client";
import type { Property, Unit, UnitStatus } from "./premium/contract";
import { audit } from "./store";

/**
 * VERIFIED LIVE INVENTORY. Unit status is read live (GET /inventory) and
 * written only through PATCH /inventory/:unitId with {status, lastVerifiedAt}.
 * The premium app owns the truth and REFUSES (409) a verification older than
 * the one it already has — a delayed sync can never overwrite a newer check.
 * This desk surfaces that refusal as-is; it never retries with a newer
 * timestamp to force the write.
 */

/** How fresh a "last verified" stamp is. */
export type Freshness = "fresh" | "ageing" | "stale";
export const FRESH_DAYS = 7;
export const STALE_DAYS = 30;

export function freshness(lastVerifiedAt: string, now = Date.now()): Freshness {
  const days = (now - Date.parse(lastVerifiedAt)) / 86_400_000;
  return days <= FRESH_DAYS ? "fresh" : days <= STALE_DAYS ? "ageing" : "stale";
}

export interface InventoryRow extends Unit {
  property: Pick<Property, "id" | "name" | "locality" | "city"> | null;
  freshness: Freshness;
}

export async function loadInventory(now = Date.now()): Promise<InventoryRow[]> {
  const units = await premium.listInventory({});
  const ids = Array.from(new Set(units.map((u) => u.projectId)));
  const props = new Map(
    await Promise.all(ids.map(async (id) => [id, await premium.getProperty(id).then((p) => ({ id: p.id, name: p.name, locality: p.locality, city: p.city })).catch(() => null)] as const)),
  );
  return units
    .map((u) => ({ ...u, property: props.get(u.projectId) ?? null, freshness: freshness(u.lastVerifiedAt, now) }))
    .sort((a, b) => (a.property?.name ?? a.projectId).localeCompare(b.property?.name ?? b.projectId) || a.unitId.localeCompare(b.unitId));
}

export type VerifyResult = { ok: true; unit: Unit } | { ok: false; conflict: boolean; message: string };

/** One rep verification → premium. A 409 comes back as { conflict: true } with premium's reason. */
export async function verifyUnit(input: { unitId: string; status: UnitStatus; lastVerifiedAt: string; actor: string; leadId?: string | null }): Promise<VerifyResult> {
  try {
    const unit = await premium.patchUnit(input.unitId, { status: input.status, lastVerifiedAt: input.lastVerifiedAt });
    await audit("inventory-verified", input.leadId ?? null, input.actor, `${input.unitId} → ${input.status} · verified ${input.lastVerifiedAt}`);
    return { ok: true, unit };
  } catch (error) {
    if (error instanceof PremiumError && error.status === 409) {
      await audit("inventory-refused", input.leadId ?? null, input.actor, `${input.unitId}: premium refused an older verification (${input.lastVerifiedAt}) — ${error.message}`);
      return { ok: false, conflict: true, message: error.message };
    }
    if (error instanceof PremiumError) return { ok: false, conflict: false, message: error.message };
    throw error;
  }
}

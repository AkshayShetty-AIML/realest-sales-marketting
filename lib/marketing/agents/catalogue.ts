import "server-only";
import { premium } from "../../premium/client";
import { marketing } from "../../premium/marketing-client";
import type { Lead, LeadDetail, Property, Unit } from "../../premium/contract";
import type { Attribution } from "../../premium/marketing-contract";

/**
 * THE ONE READ PATH for buildings, units and leads in the marketing harness:
 * the premium app's internal API (service key, server only) — the same source
 * the sales desk, campaigns and buyer lists read. Premium is the ONE writer
 * of inventory and the ONE leads store; the harness keeps no copies (company
 * memory holds marketing knowledge and pointers only).
 *
 * TENANCY: a workspace is linked to ONE premium builder (workspace.builderId =
 * the builder's name, unique across workspaces) and sees only that builder's
 * buildings, units and leads.
 *
 * SEAM: setCatalogue() swaps the source (tests use an in-memory catalogue).
 */

export interface Catalogue {
  getProperty(id: string): Promise<Property>;
  /** Buildings of one builder — the projects with units in premium's inventory. */
  builderProperties(builder: string): Promise<Property[]>;
  units(propertyId: string): Promise<Unit[]>;
  getLead(leadId: string): Promise<LeadDetail>;
  /** Leads on one builder's buildings (premium's leads store). */
  builderLeads(builder: string, limit?: number): Promise<Lead[]>;
  /** Leads on specific buildings (premium's leads store). */
  leadsFor(propertyIds: string[], limit?: number): Promise<Lead[]>;
  attribution(leadId: string): Promise<Attribution | null>;
}

/** Builder names compare case- and space-insensitively ("Trishul Infra" = "trishul  infra"). */
export const sameBuilder = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && a!.trim().toLowerCase().replace(/\s+/g, " ") === b!.trim().toLowerCase().replace(/\s+/g, " ");

export const premiumCatalogue: Catalogue = {
  getProperty: (id) => premium.getProperty(id),
  async builderProperties(builder) {
    const ids = Array.from(new Set((await premium.listInventory({})).map((u) => u.projectId)));
    const props = await Promise.all(ids.map((id) => premium.getProperty(id).catch(() => null)));
    return props.filter((p): p is Property => p !== null && sameBuilder(p.builder, builder));
  },
  units: (propertyId) => premium.listInventory({ projectId: propertyId }),
  getLead: (leadId) => premium.getLead(leadId),
  async builderLeads(builder, limit = 50) {
    const ids = new Set((await this.builderProperties(builder)).map((p) => p.id));
    return (await premium.listLeads({ limit: 200 })).filter((l) => ids.has(l.propertyId)).slice(0, limit);
  },
  async leadsFor(propertyIds, limit = 50) {
    const ids = new Set(propertyIds);
    return ids.size ? (await premium.listLeads({ limit: 200 })).filter((l) => ids.has(l.propertyId)).slice(0, limit) : [];
  },
  attribution: (leadId) => marketing.getAttribution(leadId).catch(() => null),
};

/** A workspace covers a building when it is its builder's, or it claimed that building (workspace.projects). */
export const covers = (workspace: { builderId: string | null; projects?: string[] }, property: { id: string; builder: string }) =>
  sameBuilder(property.builder, workspace.builderId) || (workspace.projects ?? []).includes(property.id);

/** The workspace's buildings: its builder's plus the ones it claimed. */
export async function workspaceProperties(workspace: { builderId: string | null; projects?: string[] }): Promise<Property[]> {
  const own = workspace.builderId ? await catalogue().builderProperties(workspace.builderId).catch(() => []) : [];
  const claimed = await Promise.all((workspace.projects ?? []).filter((id) => !own.some((p) => p.id === id)).map((id) => catalogue().getProperty(id).catch(() => null)));
  return [...own, ...claimed.filter((p): p is Property => p !== null)];
}

/** The workspace's leads: on its builder's buildings and on the buildings it claimed. */
export async function workspaceLeads(workspace: { builderId: string | null; projects?: string[] }, limit = 50): Promise<Lead[]> {
  const [a, b] = await Promise.all([workspace.builderId ? catalogue().builderLeads(workspace.builderId, limit).catch(() => []) : [], catalogue().leadsFor(workspace.projects ?? [], limit).catch(() => [])]);
  const seen = new Set<string>();
  return [...a, ...b].filter((l) => !seen.has(l.id) && seen.add(l.id)).slice(0, limit);
}

const g = globalThis as unknown as { __harnessCatalogue?: Catalogue };
export const catalogue = (): Catalogue => g.__harnessCatalogue ?? premiumCatalogue;
/** SEAM: replace the source (tests). */
export function setCatalogue(next: Catalogue | null): void {
  g.__harnessCatalogue = next ?? undefined;
}

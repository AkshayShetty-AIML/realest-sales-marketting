import "server-only";
import { premium } from "./premium/client";
import type { Lead, Unit } from "./premium/contract";

/**
 * The projects the desk can work on, from premium only: its buildings, the
 * projects with units in the inventory, and the projects leads came in on.
 * Names come from premium too. Nothing is stored here.
 */
export interface ProjectOption {
  id: string;
  name: string;
  units: { unitId: string; label: string; status: Unit["status"]; indicative: boolean }[];
}

export async function listProjects(leads?: Lead[]): Promise<ProjectOption[]> {
  const [buildings, units, all] = await Promise.all([premium.listBuildings().catch(() => []), premium.listInventory({}).catch(() => [] as Unit[]), leads ? Promise.resolve(leads) : premium.listAllLeads().catch(() => [] as Lead[])]);
  const names = new Map<string, string>();
  for (const b of buildings) names.set(b.projectId ?? b.id, b.name);
  for (const l of all) if (l.context.property) names.set(l.propertyId, names.get(l.propertyId) ?? l.context.property.name);
  for (const u of units) if (!names.has(u.projectId)) names.set(u.projectId, (await premium.getProperty(u.projectId).catch(() => null))?.name ?? u.projectId);
  return Array.from(names.entries())
    .map(([id, name]) => ({ id, name, units: units.filter((u) => u.projectId === id).map((u) => ({ unitId: u.unitId, label: u.label ?? u.unitNo ?? u.unitId, status: u.status, indicative: Boolean(u.indicative) })) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

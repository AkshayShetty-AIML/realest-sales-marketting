import "server-only";
import { premium } from "../premium/client";

/**
 * Buildings the marketing workspace can work on: the projects in the spine's
 * live inventory (GET /inventory → GET /properties/:id). Single tenant — this
 * instance's inventory IS the builder's portfolio.
 */
export interface Building {
  id: string;
  name: string;
  builder: string;
  locality: string;
  city: string;
  units: number;
  available: number;
}

export async function listBuildings(): Promise<Building[]> {
  const units = await premium.listInventory({});
  const byProject = new Map<string, { units: number; available: number }>();
  for (const u of units) {
    const c = byProject.get(u.projectId) ?? { units: 0, available: 0 };
    c.units += 1;
    if (u.status === "available") c.available += 1;
    byProject.set(u.projectId, c);
  }
  const rows = await Promise.all(
    Array.from(byProject.entries()).map(async ([id, c]) => {
      const p = await premium.getProperty(id).catch(() => null);
      return p ? { id, name: p.name, builder: p.builder, locality: p.locality, city: p.city, ...c } : null;
    }),
  );
  return rows.filter((r): r is Building => r !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** Error text for a page, never a stack or a key. */
export const message = (error: unknown) => (error instanceof Error ? error.message : "Couldn't load this just now — please refresh in a minute.");

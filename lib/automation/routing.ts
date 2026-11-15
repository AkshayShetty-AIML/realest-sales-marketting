import type { Assignment, Rep } from "../store/types";

/**
 * LEAD ROUTING — which rep gets a new lead. Pure; the caller writes the
 * result to premium (PATCH /leads/:id assignedTo) and to the assignment log.
 *
 *  1. Active reps who cover the property's locality, if any; else all active reps.
 *  2. Among them, the one holding the fewest leads right now (a lead counts
 *     for whoever was assigned to it LAST).
 *  3. Ties → alphabetical by name, so routing is deterministic and testable.
 */

export interface RoutingDecision {
  rep: Rep;
  reason: string;
}

/** leadId → current rep id, from the assignment history. */
export function currentOwners(assignments: Assignment[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const a of [...assignments].sort((x, y) => x.assignedAt.localeCompare(y.assignedAt))) owners.set(a.leadId, a.repId);
  return owners;
}

export function loadByRep(assignments: Assignment[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const repId of currentOwners(assignments).values()) load.set(repId, (load.get(repId) ?? 0) + 1);
  return load;
}

export function routeLead(locality: string | null, reps: Rep[], assignments: Assignment[]): RoutingDecision | null {
  const active = reps.filter((r) => r.active);
  if (active.length === 0) return null;
  const covering = locality ? active.filter((r) => r.localities.some((l) => l.toLowerCase() === locality.toLowerCase())) : [];
  const pool = covering.length > 0 ? covering : active;
  const load = loadByRep(assignments);
  const rep = [...pool].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0];
  return {
    rep,
    reason: covering.length > 0
      ? `covers ${locality}; ${load.get(rep.id) ?? 0} open lead(s)`
      : `no rep covers ${locality ?? "this area"}; least loaded (${load.get(rep.id) ?? 0})`,
  };
}

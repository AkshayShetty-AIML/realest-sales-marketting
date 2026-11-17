import "server-only";
import { premium, PremiumError } from "./premium/client";
import { UnitConflictDetails, type Lead, type Unit } from "./premium/contract";
import { audit, store } from "./store";

/**
 * OPS-01 · THE ALLOCATION LOCK. Hold a unit for a lead (with an expiry),
 * release it, or mark it sold with a booking reference — each through
 * premium's locked unit functions (POST /units/:id/hold · release · sold).
 * Premium is the only place a unit's status lives: this desk never writes a
 * status of its own, it shows what premium answers. Two reps racing for one
 * unit: premium lets one win; the other gets a 409 saying who holds it and
 * until when, shown here in plain words.
 *
 * Every action is audited (sales audit log); holds and releases land on the
 * lead's timeline. Each call carries the Idempotency-Key the person's click
 * minted, so a double-click or a retry never holds twice.
 */

export type UnitActionResult = { ok: true; unit: Unit; note: string } | { ok: false; code: string; message: string };

const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** A refusal in words a rep understands — for unit_held, who holds it and until when. */
export async function refusalMessage(error: PremiumError): Promise<string> {
  const d = UnitConflictDetails.safeParse(error.details ?? {});
  const details = d.success ? d.data : {};
  const reps = await store().listReps().catch(() => []);
  const who = details.heldBy ? (reps.find((r) => r.id === details.heldBy)?.name ?? details.heldBy) : null;
  switch (error.code) {
    case "unit_held":
      return `Already held${who ? ` by ${who}` : ""}${details.until ? ` until ${ist(details.until)}` : ""}${details.leadId ? " for another lead" : ""}. Nothing changed.`;
    case "unit_sold":
      return `Already sold${details.bookingRef ? ` (booking ${details.bookingRef})` : ""}. Nothing changed.`;
    case "unit_not_held":
      return "This unit isn't held, so there is nothing to release.";
    case "hold_lead_mismatch":
      return `This unit is held for a different lead${who ? ` (by ${who}${details.until ? `, until ${ist(details.until)}` : ""})` : ""} — only that hold can be released or sold.`;
    case "unit_indicative":
      return "Awaiting confirmed layout — this unit is a placeholder and can't be held or sold yet.";
    case "rate_limited":
      return error.message;
    case "idempotency_in_progress":
      return "That action is still going through — refresh in a moment.";
    case "invalid_request":
      return `Premium refused the request: ${error.message}`;
    default:
      return error.message;
  }
}

async function run(kind: "hold" | "release" | "sold", unitId: string, leadId: string | null, actor: string, call: () => Promise<Unit>, describe: (u: Unit) => string): Promise<UnitActionResult> {
  try {
    const unit = await call();
    const note = describe(unit);
    await audit(`unit-${kind === "sold" ? "sold" : kind === "hold" ? "held" : "released"}`, leadId, actor, `${unit.label ?? unit.unitId}: ${note}`);
    return { ok: true, unit, note };
  } catch (error) {
    if (!(error instanceof PremiumError)) throw error;
    const message = await refusalMessage(error);
    await audit("unit-action-refused", leadId, actor, `${kind} ${unitId} refused (${error.code}): ${message}`);
    return { ok: false, code: error.code, message };
  }
}

export function holdUnit(input: { unitId: string; leadId: string; expiresAt: string; reason?: string; actor: string; idempotencyKey: string }): Promise<UnitActionResult> {
  return run("hold", input.unitId, input.leadId, input.actor, () => premium.holdUnit(input.unitId, { actor: input.actor, leadId: input.leadId, expiresAt: input.expiresAt, ...(input.reason ? { reason: input.reason } : {}) }, input.idempotencyKey), (u) => `held for lead ${input.leadId} until ${ist(u.blockedUntil ?? input.expiresAt)}${input.reason ? ` — ${input.reason}` : ""}`);
}

export function releaseUnit(input: { unitId: string; leadId: string | null; reason?: string; actor: string; idempotencyKey: string }): Promise<UnitActionResult> {
  return run("release", input.unitId, input.leadId, input.actor, () => premium.releaseUnit(input.unitId, { actor: input.actor, ...(input.leadId ? { leadId: input.leadId } : {}), ...(input.reason ? { reason: input.reason } : {}) }, input.idempotencyKey), () => `released${input.reason ? ` — ${input.reason}` : ""}`);
}

export function sellUnit(input: { unitId: string; bookingRef: string; leadId: string | null; actor: string; idempotencyKey: string }): Promise<UnitActionResult> {
  return run("sold", input.unitId, input.leadId, input.actor, () => premium.sellUnit(input.unitId, { actor: input.actor, bookingRef: input.bookingRef, ...(input.leadId ? { leadId: input.leadId } : {}) }, input.idempotencyKey), () => `sold under booking ${input.bookingRef}`);
}

// ─── the grid ───────────────────────────────────────────────────────────────

export interface GridUnit {
  unitId: string;
  label: string;
  tower: string;
  floor: number | null;
  status: "available" | "held" | "sold";
  indicative: boolean;
  config: string | null;
  facing: string | null;
  carpetSqft: number | null;
  price: number | null;
  hold: { by: string | null; byName: string | null; leadId: string | null; until: string | null; reason: string | null } | null;
  bookingRef: string | null;
  lastVerifiedAt: string;
}

export interface Grid {
  projectId: string;
  towers: string[];
  floors: number[];
  units: GridUnit[];
  layoutNote: string | null;
  leads: { id: string; name: string }[];
}

/** "A-401" / "T2 302" → "A" / "T2"; no prefix → one tower. */
export const towerOf = (u: Pick<Unit, "label" | "unitNo">) => (u.unitNo ?? u.label ?? "").trim().match(/^([A-Za-z]{1,3}\d?)[\s-]/)?.[1]?.toUpperCase() ?? "";

/** One project's units as premium has them now, laid out towers × floors. Read-only. */
export async function loadGrid(projectId: string, leadsOnProject: Lead[] = []): Promise<Grid> {
  const [units, buildings, reps] = await Promise.all([premium.listInventory({ projectId }), premium.listBuildings().catch(() => []), store().listReps()]);
  const building = buildings.find((b) => b.id === projectId || b.projectId === projectId) ?? null;
  const name = (id: string | null) => (id ? (reps.find((r) => r.id === id)?.name ?? id) : null);
  const grid: GridUnit[] = units.map((u) => ({
    unitId: u.unitId,
    label: u.label ?? u.unitNo ?? u.unitId,
    tower: towerOf(u) || "Tower",
    floor: u.floor ?? null,
    status: u.availability ?? u.status,
    indicative: Boolean(u.indicative),
    config: u.config ?? null,
    facing: u.facing ?? null,
    carpetSqft: u.carpetSqft ?? null,
    price: u.price,
    hold: u.hold ? { ...u.hold, byName: name(u.hold.by) } : (u.availability ?? u.status) === "held" ? { by: null, byName: null, leadId: null, until: u.blockedUntil ?? null, reason: null } : null,
    bookingRef: u.bookingRef ?? null,
    lastVerifiedAt: u.lastVerifiedAt,
  }));
  const floors = Array.from(new Set(grid.map((u) => u.floor ?? -1))).sort((a, b) => b - a);
  return {
    projectId,
    towers: Array.from(new Set(grid.map((u) => u.tower))).sort(),
    floors,
    units: grid.sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })),
    layoutNote: building?.layoutStatus === "indicative" ? (building.layoutNote ?? "The layout is indicative — units marked as placeholders await the builder's confirmed layout.") : null,
    leads: leadsOnProject.filter((l) => l.status !== "won" && l.status !== "lost").map((l) => ({ id: l.id, name: l.contact.name ?? "Buyer" })),
  };
}

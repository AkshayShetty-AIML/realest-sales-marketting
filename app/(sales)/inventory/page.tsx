import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { FRESH_DAYS, freshness, STALE_DAYS, type Freshness } from "@/lib/inventory";
import { loadGrid, type Grid } from "@/lib/allocation";
import { listProjects, type ProjectOption } from "@/lib/projects";
import { navCounts } from "@/lib/inbox-data";
import { premium } from "@/lib/premium/client";
import type { Lead } from "@/lib/premium/contract";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { ErrorPanel } from "@/components/ErrorPanel";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Stat } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { VerifyUnit } from "@/components/inventory/VerifyUnit";
import { InventoryGrid } from "@/components/inventory/Grid";
import { ago, when } from "@/lib/time";

export const dynamic = "force-dynamic";

const FRESH: Record<Freshness, { tone: BadgeTone; label: string }> = {
  fresh: { tone: "good", label: "Fresh" },
  ageing: { tone: "caution", label: "Ageing" },
  stale: { tone: "risk", label: "Stale" },
};

/**
 * INVENTORY — one project at a time: the grid (towers × floors, every unit's
 * status as premium has it, refreshed every 15 s and after each action) with
 * hold / release / sold through premium's allocation lock, and below it the
 * verification stamps. Nothing here stores a unit's status.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const rep = await requireRep();
  const counts = await navCounts();
  let projects: ProjectOption[] = [];
  let grid: Grid | null = null;
  let error: string | null = null;
  const wanted = (await searchParams).project;
  try {
    const leads = await premium.listAllLeads().catch(() => [] as Lead[]);
    projects = await listProjects(leads);
    const current = projects.find((p) => p.id === wanted) ?? projects.find((p) => p.units.length) ?? projects[0];
    if (current) grid = await loadGrid(current.id, leads.filter((l) => l.propertyId === current.id));
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load inventory.";
  }
  const units = grid?.units ?? [];

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} wide>
      <PageHeader title="Inventory" description="Every unit as the premium app has it. Hold a unit for a buyer, release it, or mark it sold — the premium app decides who gets a unit when two people try at once." actions={<LiveRefresh seconds={15} />} />
      {error ? (
        <ErrorPanel message={error} />
      ) : projects.length === 0 ? (
        <div className="card px-6 py-14 text-center text-[15px] text-ink">No projects yet.</div>
      ) : (
        <>
          <nav aria-label="Projects" className="mb-4 flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <Link key={p.id} href={`/inventory?project=${encodeURIComponent(p.id)}`} aria-current={p.id === grid?.projectId ? "page" : undefined} className={`rounded-full px-3 py-1.5 text-[13px] ${p.id === grid?.projectId ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>
                {p.name} <span className="font-tabular text-muted">{p.units.length}</span>
              </Link>
            ))}
          </nav>
          <div className="mb-4 grid grid-cols-4 gap-3">
            <Stat label="Available" value={units.filter((u) => !u.indicative && u.status === "available").length} tone="brand" />
            <Stat label="Held" value={units.filter((u) => !u.indicative && u.status === "held").length} tone="caution" />
            <Stat label="Sold" value={units.filter((u) => !u.indicative && u.status === "sold").length} />
            <Stat label="Awaiting confirmed layout" value={units.filter((u) => u.indicative).length} />
          </div>
          {grid && <InventoryGrid grid={grid} />}

          {units.length > 0 && (
            <details className="card mt-4 overflow-x-auto">
              <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-ink">Verification · {units.filter((u) => freshness(u.lastVerifiedAt) === "stale").length} not checked in {STALE_DAYS} days</summary>
              <table className="data-table min-w-[700px]">
                <thead><tr><th scope="col">Unit</th><th scope="col">Last verified</th><th scope="col">Verify</th></tr></thead>
                <tbody>
                  {units.map((u) => {
                    const fr = freshness(u.lastVerifiedAt);
                    return (
                      <tr key={u.unitId}>
                        <td className="font-tabular font-medium text-ink">{u.label}</td>
                        <td>
                          <div className="font-tabular text-[13px] text-ink" title={u.lastVerifiedAt}>{when(u.lastVerifiedAt)}</div>
                          <div className="mt-1"><Badge tone={FRESH[fr].tone}>{FRESH[fr].label} · {ago(u.lastVerifiedAt)}</Badge></div>
                        </td>
                        <td><VerifyUnit unitId={u.unitId} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-5 pb-3 text-[12px] text-muted">Verify confirms the unit&apos;s current status as checked. Fresh = checked in the last {FRESH_DAYS} days · stale = over {STALE_DAYS} days. If someone has already recorded a newer check, yours is not saved and you&apos;ll see why.</p>
            </details>
          )}
        </>
      )}
    </AppShell>
  );
}

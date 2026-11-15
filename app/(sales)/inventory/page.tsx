import { requireRep } from "@/lib/auth";
import { FRESH_DAYS, loadInventory, STALE_DAYS, type Freshness } from "@/lib/inventory";
import { navCounts } from "@/lib/inbox-data";
import type { UnitStatus } from "@/lib/premium/contract";
import { inr } from "@/lib/grounding/facts";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { ErrorPanel } from "@/components/ErrorPanel";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Stat } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { VerifyUnit } from "@/components/inventory/VerifyUnit";
import { ago, when } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<UnitStatus, BadgeTone> = { available: "good", blocked: "caution", sold: "neutral" };
const FRESH: Record<Freshness, { tone: BadgeTone; label: string }> = {
  fresh: { tone: "good", label: "Fresh" },
  ageing: { tone: "caution", label: "Ageing" },
  stale: { tone: "risk", label: "Stale" },
};

/** VERIFIED LIVE INVENTORY — premium's unit status, the last-verified stamp, and rep verification (409-guarded). */
export default async function InventoryPage() {
  const rep = await requireRep();
  const counts = await navCounts();
  let rows: Awaited<ReturnType<typeof loadInventory>> = [];
  let error: string | null = null;
  try {
    rows = await loadInventory();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load inventory.";
  }

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} wide>
      <PageHeader title="Inventory" description="Verified live units from the premium app. Tap Verify after you check a unit." actions={<LiveRefresh seconds={30} />} />
      {error ? (
        <ErrorPanel message={error} />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Available" value={rows.filter((r) => r.status === "available").length} tone="brand" />
            <Stat label="Blocked" value={rows.filter((r) => r.status === "blocked").length} tone="risk" />
            <Stat label="Sold" value={rows.filter((r) => r.status === "sold").length} />
            <Stat label={`Not verified in ${STALE_DAYS} days`} value={rows.filter((r) => r.freshness === "stale").length} tone={rows.some((r) => r.freshness === "stale") ? "caution" : "ink"} />
          </div>

          <section className="card mt-4 overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th scope="col">Unit</th>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Price</th>
                  <th scope="col">Last verified</th>
                  <th scope="col">Verify</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.unitId}>
                    <td className="font-tabular font-medium text-ink">{u.unitId}</td>
                    <td>
                      <div className="text-ink">{u.property?.name ?? u.projectId}</div>
                      {u.property && <div className="text-[12px] text-muted">{u.property.locality}, {u.property.city}</div>}
                    </td>
                    <td><Badge tone={STATUS_TONE[u.status]}>{u.status[0].toUpperCase() + u.status.slice(1)}</Badge></td>
                    <td className="text-right font-tabular text-ink">{u.price ? inr(u.price) : <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="font-tabular text-[13px] text-ink" title={u.lastVerifiedAt}>{when(u.lastVerifiedAt)}</div>
                      <div className="mt-1"><Badge tone={FRESH[u.freshness].tone}>{FRESH[u.freshness].label} · {ago(u.lastVerifiedAt)}</Badge></div>
                    </td>
                    <td><VerifyUnit unitId={u.unitId} status={u.status} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-14 text-center text-ink">No units in the premium inventory.</td></tr>
                )}
              </tbody>
            </table>
          </section>
          <p className="mt-3 text-[12px] text-muted">Fresh = checked in the last {FRESH_DAYS} days · stale = over {STALE_DAYS} days. If someone has already recorded a newer check, yours is not saved and you&apos;ll see why.</p>
        </>
      )}
    </AppShell>
  );
}

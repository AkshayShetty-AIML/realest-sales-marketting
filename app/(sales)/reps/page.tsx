import { requireRep } from "@/lib/auth";
import { store } from "@/lib/store";
import { loadByRep } from "@/lib/automation/routing";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { navCounts } from "@/lib/inbox-data";
import { Card } from "@/components/ui/Card";
import { Badge, DemoBadge, TagChip } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** The roster routing assigns from. `npm run db:seed` adds you (SEED_REP_EMAIL); `npm run demo:seed` adds demo reps. */
export default async function RepsPage() {
  const rep = await requireRep();
  const [reps, assignments, counts] = await Promise.all([store().listReps(), store().listAssignments(), navCounts()]);
  const load = loadByRep(assignments);
  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts}>
      <PageHeader title="Reps & routing" description="New leads go to an active rep who covers the area — whoever has the fewest leads first." />
      <div className="grid gap-4 md:grid-cols-2">
        {reps.map((r) => (
          <Card key={r.id} bodyClassName="p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-forest text-[14px] font-semibold text-white">{initials(r.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[16px] font-semibold text-ink">{r.name}</p>
                  <span className="flex gap-1.5">{r.demo && <DemoBadge />}{r.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</span>
                </div>
                <p className="truncate text-[13px] text-muted">{r.email}</p>
              </div>
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
              <div>
                <p className="text-[12px] font-medium text-muted">Covers</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.localities.length ? r.localities.map((l) => <TagChip key={l} tone="neutral"><span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink" />{l}</TagChip>) : <span className="text-[13px] text-muted">Any area</span>}
                </div>
              </div>
              <div className="text-right">
                <p className="whitespace-nowrap text-[12px] font-medium text-muted">Leads held</p>
                <p className="font-display text-[26px] leading-none text-ink font-tabular">{load.get(r.id) ?? 0}</p>
              </div>
            </div>

          </Card>
        ))}
      </div>
      {reps.length === 0 && <Card><p className="text-muted">No reps yet. Ask whoever set up the desk to add the team.</p></Card>}


    </AppShell>
  );
}

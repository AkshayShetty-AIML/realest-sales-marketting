import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import { ARCHETYPE_LABEL, type Campaign, type Segment } from "@/lib/premium/marketing-contract";
import { listBuildings, type Building } from "@/lib/marketing/data";
import { resolveList } from "@/lib/marketing/buyer-lists";
import { premium } from "@/lib/premium/client";
import { describeList } from "@/lib/marketing/labels";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { Card } from "@/components/ui/Card";
import { SegmentForm } from "@/components/marketing/Controls";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

/** BUYER LISTS — groups of your own buyers, built from your leads by ticking options (never typed in), with live member counts. */
export default async function BuyerListsPage() {
  const rep = await requireRep();
  let rows: Segment[] = [];
  let campaigns: Campaign[] = [];
  let projects: Building[] = [];
  let members = new Map<string, number>();
  let error: string | null = null;
  try {
    const [segments, camps, buildings, leads] = await Promise.all([marketing.listSegments({ limit: 200 }), marketing.listCampaigns({ limit: 200 }), listBuildings(), premium.listAllLeads()]);
    [rows, campaigns, projects] = [segments, camps, buildings];
    // Projects with leads but no units in the inventory still appear as choices.
    for (const l of leads) if (l.context.property && !projects.some((p) => p.id === l.propertyId)) projects.push({ id: l.propertyId, name: l.context.property.name, builder: l.context.property.builder, locality: l.context.property.locality, city: l.context.property.city, units: 0, available: 0 });
    members = new Map(await Promise.all(rows.map(async (s) => [s.id, (await resolveList(s.rules, undefined, leads)).leads.length] as const)));
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const names = { campaigns: new Map(campaigns.map((c) => [c.id, c.name])), projects: new Map(projects.map((p) => [p.id, p.name])), types: ARCHETYPE_LABEL as Record<string, string> };
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Buyer lists" description="Groups of your buyers, built from your leads by project, type of buyer, score, stage and last activity. Only buyers who agreed to be contacted on a channel will ever get messages on it." />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <Card className="mb-4" title="New list">
            <SegmentForm campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          </Card>
          <section className="card divide-y divide-line">
            {rows.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">{s.name}</p>
                  <p className="text-[13px] text-body">{describeList(s.rules, names)}</p>
                </div>
                <span className="shrink-0 text-right text-[12px] text-muted"><span className="block font-tabular text-[15px] font-semibold text-ink">{members.get(s.id) ?? 0} buyer{members.get(s.id) === 1 ? "" : "s"}</span>created {ago(s.createdAt)}</span>
              </div>
            ))}
            {rows.length === 0 && <p className="px-5 py-10 text-center text-muted">No lists yet.</p>}
          </section>
        </>
      )}
    </AppShell>
  );
}

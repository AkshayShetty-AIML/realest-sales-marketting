import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { Campaign } from "@/lib/premium/marketing-contract";
import { listBuildings, type Building } from "@/lib/marketing/data";
import { goalWord } from "@/lib/marketing/labels";
import { inr } from "@/lib/grounding/facts";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { NewCampaignForm } from "@/components/marketing/Controls";

export const dynamic = "force-dynamic";

/** CAMPAIGNS — each one, its goal, and what it has brought in. New campaigns are named by the standard. */
export default async function CampaignsPage() {
  const rep = await requireRep();
  let rows: Campaign[] = [];
  let projects: Building[] = [];
  let error: string | null = null;
  try {
    [rows, projects] = await Promise.all([marketing.listCampaigns({ limit: 200 }), listBuildings()]);
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Campaigns" description="Every enquiry from a campaign shows up here and in the sales team's leads." />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <div className="mb-4"><NewCampaignForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} /></div>
          <section className="card overflow-x-auto">
            <table className="data-table">
              <thead><tr><th scope="col">Campaign</th><th scope="col">Project</th><th scope="col">Goal</th><th scope="col" className="text-right">Budget</th><th scope="col" className="text-right">Enquiries</th><th scope="col" className="text-right">Bookings</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/marketing/campaigns/${encodeURIComponent(c.id)}`} className="row-link font-medium text-ink">{c.name}</Link></td>
                    <td>{c.propertyId ? projectName.get(c.propertyId) ?? "—" : "—"}</td>
                    <td>{goalWord(c.objective)}</td>
                    <td className="text-right font-tabular">{c.budgetInr !== null ? inr(c.budgetInr) : "—"}</td>
                    <td className="text-right font-tabular">{c.leads.total}</td>
                    <td className="text-right font-tabular">{c.leads.bookings}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="py-14 text-center">No campaigns yet — create your first one above.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </AppShell>
  );
}

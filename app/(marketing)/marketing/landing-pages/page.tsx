import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { Campaign, LandingPage } from "@/lib/premium/marketing-contract";
import { buildingsFor } from "@/lib/marketing/project-page";
import { myWorkspaces } from "@/lib/marketing/console/read";
import type { Property } from "@/lib/premium/contract";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { LandingBuilder } from "@/components/marketing/LandingBuilder";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

/** PROJECT PAGES — a web page per project, made from its verified details, with an enquiry form. Public only once approved and published. */
export default async function ProjectPagesPage() {
  const rep = await requireRep();
  let rows: LandingPage[] = [];
  let buildings: Property[] = [];
  let campaigns: Campaign[] = [];
  let error: string | null = null;
  try {
    // Isolation: only the buildings this operator's workspaces receive (their builder's, or connected ones), and their pages.
    [rows, buildings, campaigns] = await Promise.all([marketing.listLandingPages({ limit: 200 }), myWorkspaces(rep.repId).then(buildingsFor), marketing.listCampaigns({ limit: 200 })]);
    const mine = new Set(buildings.map((b) => b.id));
    rows = rows.filter((p) => p.propertyId && mine.has(p.propertyId));
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Project pages" description="A web page for a project, with photos, price, details and an enquiry form. Every enquiry goes straight to your sales team." />
      {error !== null ? <Problem detail={error} /> : (
        <>
          {buildings.length === 0 ? (
            <p className="card mb-4 px-5 py-4 text-[14px] text-body">No buildings yet — link a workspace to its builder (Agent Harness → Settings) and its buildings from the shared inventory appear here.</p>
          ) : (
            <LandingBuilder buildings={buildings.map((b) => ({ id: b.id, name: b.name, locality: b.locality }))} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, propertyId: c.propertyId }))} ready />
          )}
          <section className="card divide-y divide-line">
            {rows.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <Link href={`/marketing/landing-pages/${encodeURIComponent(p.id)}`} className="row-link text-[15px] font-medium text-ink">{p.title}</Link>
                  <p className="text-[13px] text-muted">{p.campaignId ? `For “${campaignName.get(p.campaignId) ?? "a campaign"}”` : "Not linked to a campaign"} · made {ago(p.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {p.status === "published" && <a href={`/b/lp/${p.slug}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-brand hover:underline">Open live page ↗</a>}
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="px-5 py-10 text-center text-muted">No pages yet — choose a project above and make one.</p>}
          </section>
        </>
      )}
    </AppShell>
  );
}

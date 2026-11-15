import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import { PremiumError } from "@/lib/premium/client";
import { CONSENT_TEXT } from "@/lib/marketing/capture";
import { MAGNETS } from "@/lib/premium/marketing-contract";
import { loadProjectPage } from "@/lib/marketing/project-page";
import { covers } from "@/lib/marketing/agents/catalogue";
import { premium } from "@/lib/premium/client";
import { ProjectPage } from "@/components/marketing/project/ProjectPage";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { TransitionControls } from "@/components/marketing/Controls";
import { CaptureForm } from "@/components/marketing/CaptureForm";
import { buttonClass } from "@/components/ui/Button";
import { workspaceForProject } from "@/lib/marketing/lead-bridge";
import { myWorkspaces } from "@/lib/marketing/console/read";
import { ConnectProject, DisconnectProject } from "@/components/harness/Controls";

export const dynamic = "force-dynamic";

/** PREVIEW of a project page, exactly as buyers will see it. Not public until approved and published. */
export default async function LandingPreview({ params }: { params: Promise<{ id: string }> }) {
  const rep = await requireRep();
  const { id } = await params;
  const page = await marketing.getLandingPage(id).catch((e) => {
    if (e instanceof PremiumError && e.status === 404) notFound();
    throw e;
  });
  const model = await loadProjectPage(page);
  const campaign = page.campaignId ? (await marketing.listCampaigns({ limit: 200 })).find((c) => c.id === page.campaignId) : null;
  const live = page.status === "published";
  // Where this page's leads get their archetype follow-ups (the marketing harness), if anywhere.
  const [target, mine] = await Promise.all([page.propertyId ? workspaceForProject(page.propertyId).catch(() => null) : null, myWorkspaces(rep.repId)]);
  const targetIsMine = target ? mine.some((w) => w.id === target.workspace.id) : false;
  // Isolation: an operator sees only pages for buildings their workspaces receive.
  const property = page.propertyId ? await premium.getProperty(page.propertyId).catch(() => null) : null;
  if (!property || !mine.some((w) => covers(w, property))) notFound();
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing" wide>
      <PageHeader
        title={page.title}
        description={live ? "This page is live." : "Preview — buyers can't see this page until it's approved and published."}
        actions={<>
          <StatusBadge status={page.status} />
          {live && <a href={`/b/lp/${page.slug}`} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>Open live page ↗</a>}
          <TransitionControls objectType="landing_page" objectId={page.id} status={page.status} />
          <Link href="/marketing/landing-pages" className={buttonClass({ variant: "ghost", size: "sm" })}>All pages</Link>
        </>}
      />
      <section aria-label="Follow-ups" className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border px-4 py-3 ${target ? "border-forest/30 bg-trust-good-bg" : "border-ochre/40 bg-trust-caution-bg"}`}>
        {target ? (
          <>
            <p className="max-w-3xl text-[13px] text-ink">
              <span className="font-semibold">Archetype follow-ups are on.</span> Every lead from this page (form + quiz) enrols in its buyer type&apos;s nurture in{" "}
              {targetIsMine ? <Link className="font-medium text-brand underline" href={`/marketing/harness/approvals?ws=${encodeURIComponent(target.workspace.id)}`}>{target.workspace.name}</Link> : "another workspace"}
              {target.via === "builder" ? ` (via its builder, ${target.builder})` : ""}. Each message waits for approval — in Agent Harness → Approvals or on the lead in Sales; in-app messages are delivered on approval.
            </p>
            {targetIsMine && target.via === "project" && page.propertyId && <DisconnectProject workspaceId={target.workspace.id} propertyId={page.propertyId} />}
          </>
        ) : (
          <div className="space-y-2">
            <p className="max-w-3xl text-[13px] text-ink"><span className="font-semibold">No follow-ups yet.</span> Leads from this page reach Sales, but no workspace prepares their archetype follow-up messages.</p>
            {page.propertyId && <ConnectProject propertyId={page.propertyId} workspaces={mine.map((w) => ({ id: w.id, name: w.name }))} />}
          </div>
        )}
      </section>
      {model ? (
        <div className="overflow-hidden rounded-[16px] border border-line shadow-card">
          <ProjectPage model={model} preview={!live} enquiry={<CaptureForm pageId={page.id} magnets={[...MAGNETS]} accent={model.brand.primary} consentText={CONSENT_TEXT} utm={{ source: "preview", medium: "preview", campaign: campaign?.utmCampaign ?? undefined }} preview />} />
        </div>
      ) : (
        <p className="rounded-[10px] bg-trust-risk-bg px-4 py-3 text-[13px] text-trust-risk">This page&apos;s building isn&apos;t in the shared inventory any more, so there is nothing to show.</p>
      )}
      {model && model.brand.source === "house" && <p className="mt-3 text-[13px] text-muted">No brand kit for {model.property.builder} yet, so the page uses a neutral house style. Add their brand kit (logo, colours, fonts) to the workspace that receives this building.</p>}
    </AppShell>
  );
}

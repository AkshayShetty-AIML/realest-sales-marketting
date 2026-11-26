import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { BrandKit } from "@/lib/premium/marketing-contract";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { BrandKitForm } from "@/components/marketing/BrandKitForm";
import { ago } from "@/lib/time";
import { Card } from "@/components/ui/Card";
import { ProjectComplianceList, type ProjectComplianceRow } from "@/components/marketing/ProjectCompliance";
import { listProjects } from "@/lib/projects";
import { complianceFor } from "@/lib/compliance";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** BRAND KIT — the one kit (single-tenant) every generated asset is written on. Stored on the spine. */
export default async function BrandKitPage() {
  const rep = await requireRep();
  let kit: BrandKit | null = null;
  let rows: ProjectComplianceRow[] = [];
  let error: string | null = null;
  try {
    const [k, projects, saved] = await Promise.all([marketing.getBrandKit(), listProjects(), store().listProjectCompliance()]);
    kit = k;
    rows = await Promise.all(
      projects.map(async (p) => {
        const s = saved.find((x) => x.projectId === p.id);
        const c = await complianceFor(p.id);
        return {
          projectId: p.id,
          name: p.name,
          mode: s?.mode ?? null,
          reraRegNo: s?.reraRegNo ?? "",
          statement: s?.exemption?.statement ?? "",
          reason: s?.exemption?.reason ?? "",
          evidenceRef: s?.exemption?.evidenceRef ?? "",
          current: c ? `Messages carry: ${c.line}${c.source === "premium" ? " (from the listing)" : ""}` : "Nothing set — messages on this project are not sent",
        };
      }),
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Brand settings" description={kit ? `Your logo, colours, fonts and RERA number — used on every post and page. Last saved ${ago(kit.updatedAt)}.` : "Add your logo, colours and RERA number. Posts and pages can't be made until the RERA number is added."} />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <Card className="mb-4" title="Projects — RERA number or exemption" eyebrow="Every message to a buyer ends with its project's line. A project with neither gets no messages until one is added.">
            {rows.length ? <ProjectComplianceList rows={rows} /> : <p className="text-[13px] text-muted">No projects yet.</p>}
          </Card>
          <BrandKitForm initial={kit} />
        </>
      )}
    </AppShell>
  );
}

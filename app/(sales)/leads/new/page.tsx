import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { listProjects, type ProjectOption } from "@/lib/projects";
import { navCounts } from "@/lib/inbox-data";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { ErrorPanel } from "@/components/ErrorPanel";
import { AddLeadForm } from "@/components/lead/AddLeadForm";

export const dynamic = "force-dynamic";

/** SAL-10 — a lead entered by hand. It goes through the same new-lead handling as any other (first reply, score, sequence, rep). */
export default async function AddLeadPage() {
  const rep = await requireRep();
  const counts = await navCounts();
  let projects: ProjectOption[] = [];
  let error: string | null = null;
  try {
    projects = await listProjects();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load projects.";
  }
  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts}>
      <Link href="/inbox" className="text-[12px] font-medium text-muted hover:text-brand">← Back to leads</Link>
      <PageHeader title="Add lead" description="Someone who walked in, called, was referred or met you at an event. They get the same follow-up as any enquiry." />
      {error ? <ErrorPanel message={error} /> : projects.length === 0 ? <div className="card px-6 py-14 text-center text-ink">No projects yet.</div> : <AddLeadForm projects={projects} />}
    </AppShell>
  );
}

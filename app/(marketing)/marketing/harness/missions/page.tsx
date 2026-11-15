import Link from "next/link";
import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { missions, myWorkspace, myWorkspaces } from "@/lib/marketing/console/read";
import { DEMO_MISSION } from "@/lib/marketing/console/demo";
import { PageHeader } from "@/app/_shell/AppShell";
import { NewMission } from "@/components/harness/Controls";
import { WorkspacePicker } from "@/components/harness/Nav";
import { Empty, Panel, StatusPill } from "@/components/harness/Parts";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

const BAR: Record<string, string> = { done: "bg-forest", doing: "bg-status-run", blocked: "bg-ochre", failed: "bg-trust-risk-fill", todo: "bg-line-strong" };

/** MISSIONS — every goal in the operator's workspaces, newest first, and the intake to start one. */
export default async function MissionsPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const rep = await requireRep();
  const { ws } = await searchParams;
  const [spaces, current] = await Promise.all([myWorkspaces(rep.repId), myWorkspace(rep.repId, ws)]);
  const rows = await missions(rep.repId, current?.id);
  return (
    <>
      <PageHeader
        title="Missions"
        description="Give the agents a goal. The planner breaks it into tasks, sub-agents take them in parallel, and anything outbound waits for your approval."
        actions={<Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} allowAll /></Suspense>}
      />
      {spaces.length > 0 && (
        <Panel title="Start a mission" className="mb-5">
          <NewMission workspaces={spaces.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled }))} defaultWorkspace={current?.id} defaultText={current?.demo ? DEMO_MISSION : ""} />
        </Panel>
      )}
      {rows.length === 0 ? (
        <Empty title={spaces.length === 0 ? "No workspaces yet" : "No missions yet"}>{spaces.length === 0 ? <>Create a workspace on the <Link className="text-brand underline" href="/marketing/harness">Operations</Link> tab first.</> : "Start one above."}</Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr><th>Mission</th><th>Workspace</th><th>Status</th><th>Tasks</th><th>Approvals</th><th>Started</th></tr>
            </thead>
            <tbody>
              {rows.map(({ workspace, goal, counts, pendingApprovals }) => {
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                return (
                  <tr key={goal.id} className="relative">
                    <td className="max-w-[520px]">
                      <Link className="row-link font-medium text-ink" href={`/marketing/harness/missions/${encodeURIComponent(workspace.id)}/${encodeURIComponent(goal.id)}`}>{goal.text}</Link>
                      <p className="mt-0.5 text-[12px] text-muted">{goal.source.startsWith("operator:") ? "Operator" : goal.source.startsWith("schedule:") ? "Schedule" : "Event"}{goal.planner ? ` · planned by ${goal.planner.kind === "llm" ? goal.planner.model ?? "model" : goal.planner.kind}` : ""}{goal.tainted ? " · untrusted input" : ""}</p>
                    </td>
                    <td className="text-[13px] text-body">{workspace.name}</td>
                    <td><StatusPill status={goal.status} /></td>
                    <td>
                      <div className="flex h-2 w-36 overflow-hidden rounded-full bg-surface-alt" aria-label={`${counts.done} of ${total} done`}>
                        {(["done", "doing", "blocked", "failed", "todo"] as const).map((s) => counts[s] ? <span key={s} className={BAR[s]} style={{ width: `${(counts[s] / total) * 100}%` }} /> : null)}
                      </div>
                      <p className="mt-1 font-tabular text-[12px] text-muted">{counts.done}/{total} done{counts.blocked ? ` · ${counts.blocked} blocked` : ""}</p>
                    </td>
                    <td className={`font-tabular ${pendingApprovals ? "font-semibold text-ochre" : "text-muted"}`}>{pendingApprovals}</td>
                    <td className="text-[13px] text-muted">{ago(goal.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

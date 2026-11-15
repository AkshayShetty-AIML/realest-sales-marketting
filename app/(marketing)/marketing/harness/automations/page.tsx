import Link from "next/link";
import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { myWorkspace, myWorkspaces, schedulesFor } from "@/lib/marketing/console/read";
import { PageHeader } from "@/app/_shell/AppShell";
import { NewSchedule, ScheduleActions } from "@/components/harness/Controls";
import { WorkspacePicker } from "@/components/harness/Nav";
import { Empty, Panel, StatusPill } from "@/components/harness/Parts";
import { ago, when } from "@/lib/time";

export const dynamic = "force-dynamic";

/** AUTOMATIONS — schedules and event triggers. Each firing submits a mission through the same intake and approval gate. */
export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const rep = await requireRep();
  const { ws } = await searchParams;
  const [spaces, current] = await Promise.all([myWorkspaces(rep.repId), myWorkspace(rep.repId, ws)]);
  const rows = await schedulesFor(rep.repId, current?.id);
  return (
    <>
      <PageHeader
        title="Automations"
        description="Missions that start on a schedule (workspace timezone) or when an event happens. Outbound steps still wait for approval; in suggest-only workspaces a firing only plans."
        actions={<Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} allowAll /></Suspense>}
      />
      {spaces.length > 0 && <Panel title="New automation" className="mb-5"><NewSchedule workspaces={(current ? [current, ...spaces.filter((s) => s.id !== current.id)] : spaces).map((s) => ({ id: s.id, name: s.name }))} /></Panel>}
      {rows.length === 0 ? <Empty title="No automations yet" /> : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Automation</th><th>Workspace</th><th>Trigger</th><th>Status</th><th>Next run</th><th>Last run</th><th /></tr></thead>
            <tbody>
              {rows.map(({ workspace, schedule: s }) => (
                <tr key={s.id}>
                  <td className="max-w-[360px]"><p className="font-medium text-ink">{s.name}</p><p className="truncate text-[12px] text-muted">{s.goal}</p></td>
                  <td className="text-[13px] text-body">{workspace.name}</td>
                  <td className="font-mono text-[12px] text-body">{s.trigger.kind === "cron" ? s.trigger.cron : `on ${s.trigger.event}`}</td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="text-[13px] text-body">{s.nextRunAt ? when(s.nextRunAt) : "—"}</td>
                  <td className="text-[13px] text-body">{s.lastRunAt ? <>{ago(s.lastRunAt)}{s.lastGoalId && <> · <Link className="text-brand hover:underline" href={`/marketing/harness/missions/${encodeURIComponent(workspace.id)}/${encodeURIComponent(s.lastGoalId)}`}>mission</Link></>}</> : "Never"}</td>
                  <td><ScheduleActions workspaceId={workspace.id} scheduleId={s.id} status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

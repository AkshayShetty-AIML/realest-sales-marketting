import Link from "next/link";
import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { auditFor, myWorkspace, myWorkspaces } from "@/lib/marketing/console/read";
import { PageHeader } from "@/app/_shell/AppShell";
import { NewCheckpoint, RollbackButton } from "@/components/harness/Controls";
import { WorkspacePicker } from "@/components/harness/Nav";
import { Empty, Panel } from "@/components/harness/Parts";
import { auditTone } from "@/components/harness/words";
import { ago, when } from "@/lib/time";

export const dynamic = "force-dynamic";

const DOT: Record<string, string> = { approval: "bg-ochre", tool: "bg-status-run", goal: "bg-forest", checkpoint: "bg-status-dry", schedule: "bg-sage", settings: "bg-ink", risk: "bg-trust-risk-fill", step: "bg-status-idle" };

/** AUDIT — the workspace's full trail (every decision, step and setting change) and its checkpoints, with rollback. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ ws?: string; steps?: string }> }) {
  const rep = await requireRep();
  const { ws, steps } = await searchParams;
  const spaces = await myWorkspaces(rep.repId);
  const current = (await myWorkspace(rep.repId, ws)) ?? spaces[0] ?? null;
  const picker = <Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} /></Suspense>;
  if (!current) return <><PageHeader title="Audit" /><Empty title="No workspaces yet" /></>;
  const { audit, checkpoints, goalText } = await auditFor(current);
  const showSteps = steps === "1";
  const shown = showSteps ? audit : audit.filter((a) => auditTone(a.kind) !== "step");
  const base = `/marketing/harness/audit?ws=${encodeURIComponent(current.id)}`;
  return (
    <>
      <PageHeader title="Audit" description={`Everything that happened in ${current.name}: who decided what, which tools ran, every setting change — and checkpoints you can roll back to.`} actions={picker} />
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel title={`Timeline (${shown.length})`} action={<Link href={showSteps ? base : `${base}&steps=1`} className="text-[13px] font-medium text-brand hover:underline">{showSteps ? "Hide agent steps" : "Show agent steps"}</Link>}>
          {shown.length === 0 ? <Empty title="Nothing yet" /> : (
            <ol className="relative max-h-[760px] overflow-auto border-l border-line pl-5">
              {shown.map((a) => (
                <li key={a.id} className="relative py-2.5">
                  <span aria-hidden className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${DOT[auditTone(a.kind)]}`} />
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted">
                    <span className="font-mono text-[11px] text-ink">{a.kind}</span>
                    <span>{when(a.at)}</span>
                    <span>· {a.actor.replace(/^operator:/, "")}</span>
                    {a.goalId && <Link className="text-brand hover:underline" href={`/marketing/harness/missions/${encodeURIComponent(current.id)}/${encodeURIComponent(a.goalId)}${a.taskId ? `?task=${encodeURIComponent(a.taskId)}` : ""}`}>{(goalText.get(a.goalId) ?? "mission").slice(0, 50)}</Link>}
                  </p>
                  <p className="mt-0.5 break-words text-[13px] text-ink">{a.detail.length > 300 ? `${a.detail.slice(0, 300)}…` : a.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Checkpoints">
          <p className="mb-3 text-[13px] text-body">Snapshot the workspace (memory, settings, automations), make changes, and roll back. A rollback saves the current state first, so it can be undone.</p>
          <NewCheckpoint workspaceId={current.id} />
          {checkpoints.length === 0 ? <div className="mt-4"><Empty title="No checkpoints yet" /></div> : (
            <ul className="mt-4 divide-y divide-line">
              {checkpoints.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{c.label}</p>
                    <p className="text-[12px] text-muted">{c.scope} · {c.providers.join(", ")} · {ago(c.createdAt)} · {c.createdBy.replace(/^operator:/, "")}</p>
                  </div>
                  <RollbackButton workspaceId={current.id} checkpointId={c.id} label={c.label} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

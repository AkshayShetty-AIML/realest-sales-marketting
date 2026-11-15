import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { operations } from "@/lib/marketing/console/read";
import { PageHeader } from "@/app/_shell/AppShell";
import { NewWorkspace, WorkspaceToggle } from "@/components/harness/Controls";
import { DemoBadge } from "@/components/ui/Badge";
import { Empty, initials, StatTile } from "@/components/harness/Parts";
import { autonomyWord } from "@/components/harness/words";
import { AgentsIcon, BuildingIcon, ShieldIcon, SendIcon } from "@/components/icons";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

const AUTONOMY_TONE: Record<string, string> = {
  "autonomous-within-guardrails": "bg-trust-good-bg text-trust-good",
  "approve-each": "bg-trust-caution-bg text-trust-caution",
  "suggest-only": "bg-status-run-bg text-status-run",
};

/**
 * OPERATIONS — every workspace this operator belongs to, with live counts.
 * Tiles are sums of the same counts (no metric without a source: there is no
 * "system health" signal, so none is shown).
 */
export default async function OperationsPage() {
  const rep = await requireRep();
  const { summaries, totals } = await operations(rep.repId);
  return (
    <>
      <PageHeader title="Workspaces" description="All projects and campaigns across the company. Monitor agent activity, approvals and missions." actions={<NewWorkspace />} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<BuildingIcon size={20} />} value={totals.workspaces} label="Workspaces" />
        <StatTile icon={<AgentsIcon size={20} />} value={totals.agentsRunning} label="Agents running now" tone="run" />
        <StatTile icon={<SendIcon size={20} />} value={totals.activeGoals} label="Active missions" tone="violet" />
        <StatTile icon={<ShieldIcon size={20} />} value={totals.pendingApprovals} label="Approvals waiting" tone="caution" />
      </div>

      {summaries.length === 0 ? (
        <Empty title="No workspaces yet">Create one to give the agents a company to work for (it starts switched off, in suggest-only mode). To try it with sample data, run <code>npm run demo:seed</code>.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaries.map(({ workspace: w, goals, activeGoals, agentsRunning, agentsWaiting, pendingApprovals, lastActivity }) => (
            <article key={w.id} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-rail-bg font-display text-[20px] text-white">{initials(w.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkspaceToggle workspaceId={w.id} enabled={w.enabled} />
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${AUTONOMY_TONE[w.autonomy] ?? "bg-surface-alt text-body"}`}>{autonomyWord(w.autonomy)}</span>
                    {w.demo && <DemoBadge />}
                  </div>
                  <Link href={`/marketing/harness/missions?ws=${encodeURIComponent(w.id)}`} className="mt-2 block truncate text-[17px] font-semibold text-ink hover:underline">{w.name}</Link>
                  <p className="truncate text-[12px] text-muted">{w.builderId ? `Linked to ${w.builderId}` : "Not linked to the spine"} · {w.timezone}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-4 divide-x divide-line border-t border-line pt-3 text-center">
                <div><dt className="sr-only">Missions</dt><dd className="font-tabular text-[18px] font-semibold text-ink">{goals}</dd><p className="text-[11px] text-muted">Missions{activeGoals ? ` · ${activeGoals} active` : ""}</p></div>
                <div><dt className="sr-only">Agents</dt><dd className="font-tabular text-[18px] font-semibold text-ink">{agentsRunning}</dd><p className="text-[11px] text-muted">Running{agentsWaiting ? ` · ${agentsWaiting} waiting` : ""}</p></div>
                <div><dt className="sr-only">Approvals</dt><dd className={`font-tabular text-[18px] font-semibold ${pendingApprovals ? "text-ochre" : "text-ink"}`}>{pendingApprovals}</dd><p className="text-[11px] text-muted">Approvals</p></div>
                <div><dt className="sr-only">Last activity</dt><dd className="whitespace-nowrap text-[12px] font-semibold leading-[27px] text-ink">{w.enabled ? ago(lastActivity).replace(" min ago", "m ago").replace(" h ago", "h ago") : "Off"}</dd><p className="text-[11px] text-muted">Last activity</p></div>
              </dl>
              <div className="mt-3 flex gap-2 text-[13px]">
                <Link className="font-medium text-brand hover:underline" href={`/marketing/harness/missions?ws=${encodeURIComponent(w.id)}`}>Missions</Link>
                <span className="text-line-strong">·</span>
                <Link className="font-medium text-brand hover:underline" href={`/marketing/harness/approvals?ws=${encodeURIComponent(w.id)}`}>Approvals</Link>
                <span className="text-line-strong">·</span>
                <Link className="font-medium text-brand hover:underline" href={`/marketing/harness/settings?ws=${encodeURIComponent(w.id)}`}>Settings</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

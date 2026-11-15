import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { myWorkspace, myWorkspaces, settingsFor } from "@/lib/marketing/console/read";
import { harness } from "@/lib/marketing/harness";
import { PageHeader } from "@/app/_shell/AppShell";
import { AutoFirstReplyToggle, AutonomyControl, DeleteWorkspace, SpineLink, ToolSettingControls, WorkspaceToggle } from "@/components/harness/Controls";
import { WorkspacePicker } from "@/components/harness/Nav";
import { Empty, Marker, Panel } from "@/components/harness/Parts";
import { agentWord, OUTBOUND_WORD } from "@/components/harness/words";
import { DemoBadge } from "@/components/ui/Badge";
import { ALWAYS_NEEDS_APPROVAL, FIRST_TOUCH_TYPES } from "@/lib/marketing/agents/first-touch";

export const dynamic = "force-dynamic";

/** SETTINGS — per workspace: the harness on/off switch, its autonomy level, and each tool (disable, or make it always ask). */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const rep = await requireRep();
  const { ws } = await searchParams;
  const spaces = await myWorkspaces(rep.repId);
  const current = (await myWorkspace(rep.repId, ws)) ?? spaces[0] ?? null;
  const picker = <Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} /></Suspense>;
  if (!current) return <><PageHeader title="Settings" /><Empty title="No workspaces yet" /></>;
  const { tools, agentTypes } = await settingsFor(current);
  const kit = await harness().memory(current.id).get("brand_kit", "main");
  const builderName = typeof kit?.data.builderName === "string" && kit.data.builderName.trim() ? kit.data.builderName.trim() : null;
  return (
    <>
      <PageHeader title="Settings" description={`How much ${current.name}'s agents may do on their own. Outbound actions — sending, publishing, ad spend, pricing, going live — always wait for a person, at every level; the only exception is automatic first replies to new leads, if you switch them on.`} actions={picker} />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Panel title="Harness">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[13px] text-body">When off, no missions start, running agents stop at their next step, and automations are skipped.</p>
              <WorkspaceToggle workspaceId={current.id} enabled={current.enabled} />
            </div>
          </Panel>
          <Panel title="Automatic first replies">
            <div className="flex items-start justify-between gap-4">
              <p className="max-w-xl text-[13px] text-body">When on, a new lead on this workspace&apos;s projects gets its first reply straight away, in-app, without waiting for approval — only these kinds of message, each with your RERA number and an AI label. The harness must be on too.</p>
              <AutoFirstReplyToggle workspaceId={current.id} on={Boolean(current.autoFirstReply)} />
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[12px] font-semibold text-ink">Sent automatically</p>
                <ul className="mt-1 space-y-1">{FIRST_TOUCH_TYPES.map((t) => <li key={t.type} className="text-[12px] text-body"><span className="font-medium text-ink">{t.label}</span> — {t.what}</li>)}</ul>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-ink">Always drafted for your approval</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">{ALWAYS_NEEDS_APPROVAL.map((t) => <li key={t} className="text-[12px] text-body">{t}</li>)}</ul>
              </div>
            </div>
          </Panel>
          <Panel title="Autonomy level"><AutonomyControl workspaceId={current.id} autonomy={current.autonomy} /></Panel>
          <Panel title="Builder (premium inventory)">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-[13px] text-body">
                {current.builderId
                  ? `Linked to ${current.builderId}: the agents read its buildings, units and leads live from the premium inventory (the one source of truth), and leads captured on its project pages enrol here — each with its archetype's first nurture message as an approval.`
                  : "Not linked: the agents have no buildings or leads to work on. Link this workspace to the builder named in its brand kit — one workspace per builder."}
              </p>
              <SpineLink workspaceId={current.id} builderId={current.builderId} builder={builderName} />
            </div>
          </Panel>
          <Panel title={`Tools (${tools.length})`}>
            <ul className="divide-y divide-line">
              {tools.map((t) => (
                <li key={t.name} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[13px] font-semibold text-ink">{t.name}</span>{t.owner && <Marker tone="neutral">{agentWord(t.owner)}</Marker>}{t.effect === "outbound" ? <Marker tone="approval">Outbound · {OUTBOUND_WORD[t.outbound ?? ""] ?? t.outbound}</Marker> : <Marker tone="neutral">{t.effect}</Marker>}</p>
                    <p className="mt-0.5 text-[12px] text-body">{t.description}</p>
                  </div>
                  <ToolSettingControls workspaceId={current.id} tool={t.name} enabled={t.enabled} requiresApproval={t.requiresApproval} ownApproval={t.ownApproval} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Workspace">
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-[13px]">
              <dt className="text-muted">Name</dt><dd className="flex items-center gap-2 text-ink">{current.name}{current.demo && <DemoBadge />}</dd>
              <dt className="text-muted">Timezone</dt><dd className="text-ink">{current.timezone}</dd>
              <dt className="text-muted">Builder</dt><dd className="text-ink">{current.builderId ?? "Not linked"}</dd>
              <dt className="text-muted">Also receives</dt><dd className="text-ink">{current.projects?.length ? current.projects.join(", ") : "No other buildings — connect one from its project page"}</dd>
              <dt className="text-muted">Members</dt><dd className="text-ink">{current.members.join(", ")}</dd>
              <dt className="text-muted">ID</dt><dd className="font-mono text-[12px] text-body">{current.id}</dd>
            </dl>
          </Panel>
          <Panel title={`Registered agents (${agentTypes.length})`}>
            <ul className="space-y-3">
              {agentTypes.map((a) => (
                <li key={a.type}>
                  <p className="text-[14px] font-semibold text-ink">{agentWord(a.type)}</p>
                  <p className="text-[12px] text-body">{a.description}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted">{a.scopes.join(" · ")}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <section className="card border-rust/40 p-5">
            <h2 className="text-[16px] font-semibold text-trust-risk">Danger zone</h2>
            <p className="mb-3 mt-1 text-[13px] text-body">Delete this workspace and everything it owns — missions, tasks, approvals, the audit trail, checkpoints, automations and company memory. Other workspaces are not touched. This can&apos;t be undone.</p>
            <DeleteWorkspace workspaceId={current.id} name={current.name} enabled={current.enabled} />
          </section>
        </div>
      </div>
    </>
  );
}

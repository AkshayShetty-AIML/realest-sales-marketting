import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/auth";
import { missionView, type MissionView, type TaskView } from "@/lib/marketing/console/read";
import { ApprovalCard } from "@/components/harness/ApprovalCard";
import { GoalActions } from "@/components/harness/Controls";
import { FileView } from "@/components/harness/Outputs";
import { AgentGraph, ApprovalBanner, DryRunBanner, Empty, initials, Panel, StatTile, StatusPill, StepLog, TaintBanner, TaskCard, TaskMarkers } from "@/components/harness/Parts";
import { agentWord, autonomyWord } from "@/components/harness/words";
import { AgentsIcon, ClockIcon, SendIcon, ShieldIcon } from "@/components/icons";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

type Search = { tab?: string; task?: string; pane?: string; status?: string; agent?: string };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Agent Graph" },
  { id: "tasks", label: "Tasks" },
  { id: "outputs", label: "Outputs" },
  { id: "approvals", label: "Approvals" },
  { id: "analytics", label: "Analytics" },
];
const BOARD = ["todo", "doing", "blocked", "done", "failed"] as const;
const BOARD_WORD: Record<string, string> = { todo: "To do", doing: "Doing", blocked: "Blocked", done: "Done", failed: "Failed" };

/**
 * ONE MISSION — the run log as a control room. Everything here is read from
 * the harness rows (tasks, subagent_runs, approvals, memory, audit); the
 * page re-renders every few seconds (layout), so the graph, board and the
 * selected task's steps follow the agents live.
 */
export default async function MissionPage({ params, searchParams }: { params: Promise<{ ws: string; goal: string }>; searchParams: Promise<Search> }) {
  const rep = await requireRep();
  const [{ ws, goal: goalId }, sp] = await Promise.all([params, searchParams]);
  const view = await missionView(rep.repId, decodeURIComponent(ws), decodeURIComponent(goalId));
  if (!view) notFound();
  const { workspace, goal, tasks, approvals, nodes } = view;

  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "overview";
  const base = `/marketing/harness/missions/${encodeURIComponent(workspace.id)}/${encodeURIComponent(goal.id)}`;
  const href = (patch: Partial<Search>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const q = next.toString();
    return q ? `${base}?${q}` : base;
  };
  const selected = tasks.find((t) => t.id === sp.task) ?? tasks.find((t) => t.status === "doing") ?? tasks.find((t) => t.pendingApproval) ?? tasks.find((t) => t.status === "blocked") ?? tasks[0] ?? null;
  const pending = approvals.filter((a) => a.status === "pending");
  const nodeHref = (n: (typeof nodes)[number]) => href({ agent: n.type, task: n.latestTask?.id, pane: "steps" });

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-2 text-[13px] text-muted">
        <Link className="hover:text-ink" href={`/marketing/harness/missions?ws=${encodeURIComponent(workspace.id)}`}>Missions</Link>
        <span aria-hidden>›</span>
        <span>{workspace.name}</span>
        <span aria-hidden>›</span>
        <span className="truncate text-ink">{goal.text.slice(0, 80)}</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-4xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[28px] leading-tight text-ink">{goal.text}</h1>
            <StatusPill status={goal.status} />
          </div>
          <p className="mt-1 text-[14px] text-body">
            {goal.summary ?? "—"} · planned by {goal.planner?.kind === "llm" ? `${goal.planner.model ?? "model"}${goal.planner.note ? ` (${goal.planner.note})` : ""}` : goal.planner?.kind ?? "—"} · started {ago(goal.createdAt)}
            {goal.tainted && <span className="text-trust-risk"> · includes untrusted input</span>}
            {!goal.execute && <span> · plan only</span>}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-rail-bg text-[12px] font-semibold text-white">{initials(workspace.name)}</span>
            <span><span className="block text-[13px] font-semibold text-ink">{workspace.name}</span><span className="block text-[11px] text-muted">{workspace.enabled ? "On" : "Off"} · {autonomyWord(workspace.autonomy)}</span></span>
          </div>
          <GoalActions workspaceId={workspace.id} goalId={goal.id} status={goal.status} />
        </div>
      </div>

      <FinishLine view={view} href={href} />

      {/* The mission's own inner tab row — page-level, not navigation. */}
      <nav aria-label="Mission" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link key={t.id} href={href({ tab: t.id === "overview" ? undefined : t.id })} scroll={false} aria-current={tab === t.id ? "page" : undefined} className={`-mb-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] ${tab === t.id ? "border-brand font-semibold text-brand" : "border-transparent text-body hover:text-ink"}`}>
            {t.label}
            {t.id === "approvals" && pending.length > 0 && <span className="text-[13px]">({pending.length})</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr_1.1fr]">
          <Panel title="Agent Graph (Virtual Office)" action={<span className="text-[12px] text-muted">Click an agent to see its task</span>}>
            <p className="-mt-1 mb-2 text-[13px] text-muted">Live view of the registered agents and what each is doing in this mission.</p>
            <AgentGraph nodes={nodes} hrefFor={nodeHref} selected={sp.agent ?? selected?.agentType} />
          </Panel>
          <Board view={view} selected={selected} href={href} filter={sp.status} />
          <TaskPanel view={view} task={selected} href={href} pane={sp.pane} />
        </div>
      )}

      {tab === "graph" && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Agent Graph (Virtual Office)">
            <AgentGraph nodes={nodes} hrefFor={(n) => href({ tab: "graph", agent: n.type, task: n.latestTask?.id })} selected={sp.agent} height={460} />
          </Panel>
          <div className="space-y-4">
            <Panel title="Registered agents">
              <ul className="divide-y divide-line">
                {nodes.map((n) => (
                  <li key={n.type} className="py-3">
                    <div className="flex items-center gap-2">
                      <Link href={href({ tab: "graph", agent: n.type, task: n.latestTask?.id })} scroll={false} className="text-[14px] font-semibold text-ink hover:underline">{agentWord(n.type)}</Link>
                      <StatusPill status={n.status} />
                      <span className="ml-auto text-[12px] text-muted">{n.tasks} task{n.tasks === 1 ? "" : "s"}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-body">{n.description}</p>
                    <p className="mt-1.5 flex flex-wrap gap-1">{n.tools.map((t) => <span key={t.name} className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] ${t.requiresApproval ? "bg-trust-caution-bg text-trust-caution" : "bg-surface-alt text-body"}`} title={t.requiresApproval ? "needs operator approval" : t.effect}>{t.name}{t.requiresApproval ? " ✋" : ""}</span>)}</p>
                  </li>
                ))}
              </ul>
            </Panel>
            {sp.agent && <TaskPanel view={view} task={tasks.find((t) => t.id === sp.task) ?? tasks.find((t) => t.agentType === sp.agent) ?? null} href={href} pane={sp.pane} />}
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {BOARD.map((s) => {
              const col = tasks.filter((t) => t.status === s);
              return (
                <section key={s} className="rounded-[12px] bg-surface-alt p-3">
                  <h2 className="mb-2 flex items-center justify-between px-1 text-[13px] font-semibold text-ink">{BOARD_WORD[s]}<span className="font-tabular text-muted">{col.length}</span></h2>
                  <div className="space-y-2">{col.length === 0 ? <p className="px-1 py-4 text-center text-[12px] text-muted">None</p> : col.map((t) => <TaskCard key={t.id} task={t} href={href({ tab: "tasks", task: t.id })} selected={t.id === selected?.id} />)}</div>
                </section>
              );
            })}
          </div>
          {selected && <TaskPanel view={view} task={selected} href={href} pane={sp.pane} />}
        </div>
      )}

      {tab === "outputs" && <Outputs view={view} href={href} />}

      {tab === "approvals" && (
        approvals.length === 0 ? <Empty title="No approvals in this mission">Outbound actions (posts, emails, go-live) appear here for your decision.</Empty> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {[...pending, ...approvals.filter((a) => a.status !== "pending")].map((a) => <ApprovalCard key={a.id} approval={a} workspace={workspace} showMission={false} />)}
          </div>
        )
      )}

      {tab === "analytics" && <Analytics view={view} />}
    </>
  );
}

// ─── the finish line ────────────────────────────────────────────────────────

const SEG: Record<string, string> = { done: "bg-forest", doing: "bg-status-run", blocked: "bg-ochre", failed: "bg-trust-risk-fill", todo: "bg-line-strong" };

/** Where the mission stands and what (if anything) it needs from you to finish — read from its tasks and approvals. */
function FinishLine({ view, href }: { view: MissionView; href: (p: Partial<Search>) => string }) {
  const { goal, tasks, approvals, artifacts } = view;
  const n = (s: string) => tasks.filter((t) => t.status === s).length;
  const pending = approvals.filter((a) => a.status === "pending");
  const ran = artifacts.filter((a) => a.kind === "outbox").length;
  const declined = approvals.filter((a) => a.status === "declined").length;
  const stuck = tasks.filter((t) => t.status === "blocked" && !t.pendingApproval);
  let tone = "border-line bg-surface";
  let body: React.ReactNode;
  if (goal.status === "done") {
    tone = "border-forest/40 bg-trust-good-bg";
    body = <p className="text-[14px] text-ink"><span className="font-semibold text-trust-good">Mission complete.</span> All {tasks.length} tasks done{ran ? ` · ${ran} approved outbound action${ran === 1 ? "" : "s"} ran in dry-run (recorded, not sent)` : ""}{declined ? ` · ${declined} declined by you` : ""}. See everything it produced under <Link className="font-medium text-brand underline" href={href({ tab: "outputs" })}>Outputs</Link>.</p>;
  } else if (goal.status === "cancelled") {
    body = <p className="text-[14px] text-body">Cancelled.</p>;
  } else if (pending.length > 0) {
    tone = "border-ochre/50 bg-trust-caution-bg";
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[14px] text-ink"><span className="font-semibold">{pending.length} action{pending.length === 1 ? " is" : "s are"} waiting for you.</span> The agents have done everything they can on their own; the mission continues the moment you approve or decline.</p>
        <Link href={`${href({ tab: "approvals" })}#${pending[pending.length - 1].id}`} className="inline-flex h-9 items-center rounded-control bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand-hover">Review next approval →</Link>
      </div>
    );
  } else if (goal.status === "running" || n("doing") > 0) {
    tone = "border-status-run/30 bg-status-run-bg";
    body = <p className="text-[14px] text-ink"><span className="font-semibold text-status-run">Agents are working</span> — {n("doing")} task{n("doing") === 1 ? "" : "s"} in progress. This page updates by itself.</p>;
  } else if (goal.status === "planned") {
    body = <p className="text-[14px] text-ink">Planned only — press <b>Run</b> to start the agents.</p>;
  } else if (stuck.length > 0) {
    tone = "border-rust/30 bg-trust-risk-bg";
    body = <div className="text-[14px] text-ink"><p className="font-semibold">Can&apos;t finish: {stuck.length} task{stuck.length === 1 ? " is" : "s are"} blocked.</p><ul className="mt-1 list-disc pl-5 text-[13px] text-body">{stuck.slice(0, 3).map((t) => <li key={t.id}><Link className="text-brand hover:underline" href={href({ task: t.id })}>{t.title}</Link> — {t.note}</li>)}</ul></div>;
  } else {
    body = <p className="text-[14px] text-body">{goal.summary}</p>;
  }
  return (
    <div className={`mb-5 rounded-[12px] border px-4 py-3 ${tone}`}>
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-white/70" aria-label={`${n("done")} of ${tasks.length} tasks done`}>
          {(["done", "doing", "blocked", "failed", "todo"] as const).map((s) => (n(s) ? <span key={s} className={SEG[s]} style={{ width: `${(n(s) / Math.max(tasks.length, 1)) * 100}%` }} /> : null))}
        </div>
        <span className="font-tabular text-[13px] font-semibold text-ink">{n("done")}/{tasks.length} done</span>
      </div>
      {body}
    </div>
  );
}

// ─── the board ──────────────────────────────────────────────────────────────

function Board({ view, selected, href, filter }: { view: MissionView; selected: TaskView | null; href: (p: Partial<Search>) => string; filter?: string }) {
  const { tasks } = view;
  const active = BOARD.includes(filter as (typeof BOARD)[number]) ? filter : null;
  const shown = active ? tasks.filter((t) => t.status === active) : [...tasks].sort((a, b) => BOARD.indexOf(a.status) - BOARD.indexOf(b.status) || ["doing", "blocked", "todo", "failed", "done"].indexOf(a.status) - ["doing", "blocked", "todo", "failed", "done"].indexOf(b.status));
  return (
    <Panel title={`Tasks (${tasks.length})`} action={<Link href={href({ tab: "tasks" })} className="text-[13px] font-medium text-brand hover:underline">View board</Link>}>
      <div className="-mx-1 mb-3 flex flex-wrap gap-1 border-b border-line pb-2">
        <Link href={href({ status: undefined })} scroll={false} className={`rounded-full px-2.5 py-1 text-[12px] ${!active ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>All {tasks.length}</Link>
        {BOARD.map((s) => {
          const n = tasks.filter((t) => t.status === s).length;
          return <Link key={s} href={href({ status: s })} scroll={false} className={`rounded-full px-2.5 py-1 text-[12px] ${active === s ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>{BOARD_WORD[s]} <span className="font-tabular">{n}</span></Link>;
        })}
      </div>
      <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
        {shown.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">No tasks here.</p> : shown.map((t) => <TaskCard key={t.id} task={t} href={href({ task: t.id, agent: undefined })} selected={t.id === selected?.id} />)}
      </div>
    </Panel>
  );
}

// ─── the selected task ──────────────────────────────────────────────────────

const PANES = [
  { id: "steps", label: "Live Steps" },
  { id: "output", label: "Output Preview" },
  { id: "context", label: "Context" },
  { id: "files", label: "Files" },
];

function TaskPanel({ view, task, href, pane }: { view: MissionView; task: TaskView | null; href: (p: Partial<Search>) => string; pane?: string }) {
  if (!task) return <Panel title="Selected task"><Empty title="No tasks yet" /></Panel>;
  const p = PANES.some((x) => x.id === pane) ? pane! : "steps";
  const node = view.nodes.find((n) => n.type === task.agentType);
  const deps = task.dependsOn.map((d) => view.tasks.find((t) => t.id === d)).filter(Boolean) as TaskView[];
  const run = task.runs.at(-1);
  return (
    <Panel title="Selected task" bodyClassName="p-5 pt-2">
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold leading-snug text-ink">{task.title}</h3>
          <StatusPill status={task.status} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          {agentWord(task.agentType)}{run ? ` · started ${ago(run.startedAt)} · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}` : ""} <TaskMarkers task={task} />
        </p>
      </div>
      <div className="mb-3 flex gap-1 border-b border-line">
        {PANES.map((x) => (
          <Link key={x.id} href={href({ task: task.id, pane: x.id === "steps" ? undefined : x.id })} scroll={false} className={`-mb-px border-b-2 px-2.5 pb-2 text-[13px] ${p === x.id ? "border-brand font-semibold text-brand" : "border-transparent text-body hover:text-ink"}`}>
            {x.label}{x.id === "files" && task.files.length ? ` (${task.files.length})` : ""}
          </Link>
        ))}
      </div>

      {p === "steps" && <StepLog runs={task.runs} task={task} />}
      {p === "output" && (
        task.files.some((f) => f.kind !== "outbox") ? (
          <div className="max-h-[420px] space-y-2 overflow-auto">{task.files.filter((f) => f.kind !== "outbox").map((f) => <FileView key={f.id} item={f} />)}</div>
        ) : task.output ? (
          <pre className="max-h-[360px] overflow-auto rounded-[10px] bg-surface-alt p-3 text-[12px] text-body">{JSON.stringify(task.output, null, 2)}</pre>
        ) : <Empty title="No output yet">{task.note ?? "It appears here when the task finishes."}</Empty>
      )}
      {p === "context" && (
        <dl className="space-y-3 text-[13px]">
          <div><dt className="kv-label">Mission</dt><dd className="text-ink">{view.goal.text}</dd></div>
          <div><dt className="kv-label">Sub-agent</dt><dd className="text-ink">{task.agentType ? `${agentWord(task.agentType)} — ${node?.description ?? ""}` : `None registered — needs ${task.capability ?? "a capability"}`}</dd></div>
          {node && <div><dt className="kv-label">Tools · permissions</dt><dd className="font-mono text-[12px] text-body">{node.tools.map((t) => `${t.name}${t.requiresApproval ? " ✋" : ""}`).join(", ")}<br />{node.scopes.join(", ")}</dd></div>}
          <div><dt className="kv-label">Waits for</dt><dd className="text-ink">{deps.length ? deps.map((d) => <Link key={d.id} href={href({ task: d.id })} scroll={false} className="mr-2 text-brand hover:underline">{d.title}</Link>) : "Nothing — runs as soon as it can"}</dd></div>
          <div><dt className="kv-label">Input</dt><dd><pre className="overflow-auto rounded-[8px] bg-surface-alt p-2 text-[12px] text-body">{JSON.stringify(task.input, null, 2)}</pre></dd></div>
          {task.note && <div><dt className="kv-label">Note</dt><dd className="text-ink">{task.note}</dd></div>}
        </dl>
      )}
      {p === "files" && (task.files.length ? <div className="max-h-[420px] space-y-2 overflow-auto">{task.files.map((f) => <FileView key={f.id} item={f} />)}</div> : <Empty title="No files">Drafts, landing pages, calendars and dry-run records this task writes appear here.</Empty>)}

      <div className="mt-4 space-y-2">
        {task.pendingApproval && <ApprovalBanner href={`${href({ tab: "approvals" })}#${task.pendingApproval.id}`} />}
        {node?.outbound && view.dryRun && <DryRunBanner />}
        {task.tainted && <TaintBanner />}
      </div>
    </Panel>
  );
}

// ─── outputs + analytics ────────────────────────────────────────────────────

function Outputs({ view, href }: { view: MissionView; href: (p: Partial<Search>) => string }) {
  const withFiles = view.tasks.filter((t) => t.files.length > 0);
  const outbox = view.artifacts.filter((a) => a.kind === "outbox");
  if (withFiles.length === 0) return <Empty title="Nothing produced yet">Drafts, landing pages, plans and dry-run records appear here as tasks finish.</Empty>;
  return (
    <div className="space-y-5">
      {outbox.length > 0 && (
        <Panel title={`Dry-run outbox (${outbox.length})`} action={<span className="text-[12px] text-status-dry">Recorded, not sent — channels aren&apos;t connected</span>}>
          <div className="grid gap-3 lg:grid-cols-2">{outbox.map((o) => <FileView key={o.id} item={o} />)}</div>
        </Panel>
      )}
      {withFiles.map((t) => (
        <Panel key={t.id} title={<Link className="hover:underline" href={href({ tab: undefined, task: t.id })}>{t.title}</Link>} action={<span className="text-[12px] text-muted">{agentWord(t.agentType)}</span>}>
          <div className="grid gap-3 lg:grid-cols-2">{t.files.filter((f) => f.kind !== "outbox").map((f) => <FileView key={f.id} item={f} />)}</div>
        </Panel>
      ))}
    </div>
  );
}

function Analytics({ view }: { view: MissionView }) {
  const { tasks, runs, approvals, artifacts, goal, nodes } = view;
  const count = (s: string) => tasks.filter((t) => t.status === s).length;
  const toolCalls = runs.reduce((n, r) => n + r.toolCalls, 0);
  const steps = runs.reduce((n, r) => n + r.steps.length, 0);
  const agentSecs = Math.round(runs.reduce((n, r) => n + r.elapsedMs, 0) / 1000);
  const decided = (s: string) => approvals.filter((a) => a.status === s).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={<AgentsIcon size={20} />} value={runs.length} label={`Sub-agent runs · ${toolCalls} tool calls · ${steps} steps`} tone="run" />
        <StatTile icon={<SendIcon size={20} />} value={`${count("done")}/${tasks.length}`} label={`Tasks done${count("blocked") ? ` · ${count("blocked")} blocked` : ""}${count("failed") ? ` · ${count("failed")} failed` : ""}`} />
        <StatTile icon={<ShieldIcon size={20} />} value={approvals.length} label={`Approvals · ${decided("approved")} approved · ${decided("declined")} declined · ${decided("pending")} waiting`} tone="caution" />
        <StatTile icon={<ClockIcon size={20} />} value={`${agentSecs}s`} label={`Agent time · ${artifacts.filter((a) => a.kind === "outbox").length} dry-run records`} tone="violet" />
      </div>
      <Panel title="By agent">
        <table className="data-table">
          <thead><tr><th>Agent</th><th>Status</th><th>Tasks</th><th>Runs</th><th>Tool calls</th><th>Agent time</th><th>Stopped because</th></tr></thead>
          <tbody>
            {nodes.map((n) => {
              const own = runs.filter((r) => r.agentType === n.type);
              return (
                <tr key={n.type}>
                  <td className="font-medium text-ink">{agentWord(n.type)}</td>
                  <td><StatusPill status={n.status} /></td>
                  <td className="font-tabular">{n.tasks}</td>
                  <td className="font-tabular">{own.length}</td>
                  <td className="font-tabular">{own.reduce((x, r) => x + r.toolCalls, 0)}</td>
                  <td className="font-tabular">{Math.round(own.reduce((x, r) => x + r.elapsedMs, 0) / 100) / 10}s</td>
                  <td className="text-[13px] text-body">{Array.from(new Set(own.map((r) => r.stopReason?.replace(/_/g, " ")).filter(Boolean))).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <p className="text-[12px] text-muted">Mission started {ago(goal.createdAt)}, last change {ago(goal.updatedAt)}. Campaign performance and cost per booking come from the analytics agent&apos;s report (Outputs) — attribution needs the workspace linked to the spine.</p>
    </div>
  );
}

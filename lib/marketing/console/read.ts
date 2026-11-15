import "server-only";
import { effectiveTools, harness, listAgentTypes, type Approval, type AuditEntry, type Goal, type MemoryItem, type RunStep, type SubagentRun, type Task, type TaskStatus, type Workspace } from "../harness";
import { getTool } from "../harness/tools";
import { KINDS, OUTBOUND_MODE } from "../agents";

/**
 * THE AGENT OPERATIONS CONSOLE'S READ MODEL — aggregations over rows the
 * harness already writes (workspaces, goals, tasks, subagent_runs,
 * approvals, audit_log, schedules, company memory). READ-ONLY: no business
 * logic, no agent behaviour, no writes. Every control on the console calls
 * the existing /api/marketing/* endpoints instead.
 *
 * TENANCY: every entry point takes the operator and returns only workspaces
 * they are a member of — the same rule the API applies. A workspace id that
 * isn't theirs reads as "not found".
 */

export type { Workspace, Goal, Task, SubagentRun, Approval, AuditEntry, MemoryItem, RunStep };

/** Outbound channels aren't connected: every outbound tool records instead of sending (lib/marketing/agents). */
export const DRY_RUN = OUTBOUND_MODE === "dry_run";

export async function myWorkspaces(operatorId: string): Promise<Workspace[]> {
  return (await harness().workspacesFor(operatorId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** The workspace if this operator is a member, else null. */
export async function myWorkspace(operatorId: string, workspaceId: string | undefined): Promise<Workspace | null> {
  if (!workspaceId) return null;
  const ws = await harness().getWorkspace(workspaceId);
  return ws && ws.members.includes(operatorId) ? ws : null;
}

const ACTIVE_GOAL: Goal["status"][] = ["planning", "planned", "running", "blocked"];

export interface WorkspaceSummary {
  workspace: Workspace;
  goals: number;
  activeGoals: number;
  /** Sub-agent runs executing right now. */
  agentsRunning: number;
  /** Sub-agent runs paused on an operator decision. */
  agentsWaiting: number;
  pendingApprovals: number;
  lastActivity: string | null;
}

export async function workspaceSummary(workspace: Workspace): Promise<WorkspaceSummary> {
  const scoped = harness().store.scope(workspace.id);
  const [goals, running, waiting, pending, last] = await Promise.all([
    scoped.list("goals"),
    scoped.list("subagent_runs", { status: "running" }),
    scoped.list("subagent_runs", { status: "waiting" }),
    scoped.list("approvals", { status: "pending" }),
    scoped.list("audit_log", { order: "desc", limit: 1 }),
  ]);
  return {
    workspace,
    goals: goals.length,
    activeGoals: goals.filter((g) => ACTIVE_GOAL.includes(g.status)).length,
    agentsRunning: running.length,
    agentsWaiting: waiting.length,
    pendingApprovals: pending.length,
    lastActivity: last[0]?.at ?? null,
  };
}

export async function operations(operatorId: string) {
  const summaries = await Promise.all((await myWorkspaces(operatorId)).map(workspaceSummary));
  const sum = (k: keyof Omit<WorkspaceSummary, "workspace" | "lastActivity">) => summaries.reduce((n, s) => n + s[k], 0);
  return {
    summaries,
    totals: { workspaces: summaries.length, agentsRunning: sum("agentsRunning"), activeGoals: sum("activeGoals"), pendingApprovals: sum("pendingApprovals") },
  };
}

export interface MissionRow {
  workspace: Workspace;
  goal: Goal;
  counts: Record<TaskStatus, number>;
  pendingApprovals: number;
}

export async function missions(operatorId: string, workspaceId?: string): Promise<MissionRow[]> {
  const spaces = (await myWorkspaces(operatorId)).filter((w) => !workspaceId || w.id === workspaceId);
  const rows = await Promise.all(
    spaces.map(async (workspace) => {
      const scoped = harness().store.scope(workspace.id);
      const [goals, tasks, approvals] = await Promise.all([scoped.list("goals", { order: "desc" }), scoped.list("tasks"), scoped.list("approvals", { status: "pending" })]);
      return goals.map((goal) => {
        const own = tasks.filter((t) => t.goalId === goal.id);
        const counts = { todo: 0, doing: 0, done: 0, blocked: 0, failed: 0 } as Record<TaskStatus, number>;
        for (const t of own) counts[t.status] += 1;
        return { workspace, goal, counts, pendingApprovals: approvals.filter((a) => a.goalId === goal.id).length };
      });
    }),
  );
  return rows.flat().sort((a, b) => b.goal.createdAt.localeCompare(a.goal.createdAt));
}

// ─── one mission ────────────────────────────────────────────────────────────

export type NodeStatus = "running" | "idle" | "blocked" | "done" | "failed";

export interface AgentNode {
  type: string;
  description: string;
  tools: { name: string; effect: string; requiresApproval: boolean }[];
  scopes: string[];
  /** Has an outbound tool (so its sends are dry-run today). */
  outbound: boolean;
  status: NodeStatus;
  tainted: boolean;
  /** What it's doing / did in this mission (its latest task). */
  latestTask: Task | null;
  tasks: number;
}

/** Live status of a registered agent type within a mission, from its runs and tasks. */
function nodeStatus(tasks: Task[], runs: SubagentRun[]): NodeStatus {
  if (runs.some((r) => r.status === "running") || tasks.some((t) => t.status === "doing")) return "running";
  if (runs.some((r) => r.status === "waiting" || r.status === "blocked") || tasks.some((t) => t.status === "blocked")) return "blocked";
  if (tasks.some((t) => t.status === "failed")) return "failed";
  if (tasks.length > 0 && tasks.every((t) => t.status === "done")) return "done";
  return "idle";
}

export interface TaskView extends Task {
  runs: SubagentRun[];
  pendingApproval: Approval | null;
  approvals: Approval[];
  /** An outbound action of this task ran in dry-run (recorded, sent:false). */
  dryRunRecorded: boolean;
  tainted: boolean;
  /** Memory items this task produced (drafts, landing pages, calendars, the outbox). */
  files: MemoryItem[];
}

export async function missionView(operatorId: string, workspaceId: string, goalId: string) {
  const workspace = await myWorkspace(operatorId, workspaceId);
  if (!workspace) return null;
  const scoped = harness().store.scope(workspace.id);
  const goal = await scoped.get("goals", goalId);
  if (!goal) return null;
  const [tasks, runs, approvals, audit, memory] = await Promise.all([
    scoped.list("tasks", { goalId }),
    scoped.list("subagent_runs", { goalId }),
    scoped.list("approvals", { goalId, order: "desc" }),
    scoped.list("audit_log", { goalId, order: "desc", limit: 300 }),
    scoped.list("memory_items"),
  ]);
  const produced = memory.filter((m) => m.data.goalId === goalId);
  const views: TaskView[] = tasks.map((t) => {
    const own = approvals.filter((a) => a.taskId === t.id);
    const taskRuns = runs.filter((r) => r.taskId === t.id);
    const files = produced.filter((m) => m.data.taskId === t.id);
    return {
      ...t,
      runs: taskRuns,
      approvals: own,
      pendingApproval: own.find((a) => a.status === "pending") ?? null,
      dryRunRecorded: files.some((f) => f.kind === KINDS.outbox && f.data.sent === false),
      tainted: taskRuns.some((r) => r.tainted),
      files,
    };
  });
  const nodes: AgentNode[] = listAgentTypes().map((a) => {
    const own = views.filter((t) => t.agentType === a.type);
    const ownRuns = runs.filter((r) => r.agentType === a.type);
    const tools = a.tools.map((name) => getTool(name)).filter((t) => t !== undefined).map((t) => ({ name: t.name, effect: t.effect, requiresApproval: t.requiresApproval }));
    const latestRun = [...ownRuns].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
    return {
      type: a.type,
      description: a.description,
      tools,
      scopes: a.scopes,
      outbound: tools.some((t) => t.effect === "outbound"),
      status: nodeStatus(own, ownRuns),
      tainted: ownRuns.some((r) => r.tainted),
      latestTask: (latestRun ? own.find((t) => t.id === latestRun.taskId) : own.at(-1)) ?? null,
      tasks: own.length,
    };
  });
  return { workspace, goal, tasks: views, runs, approvals, audit, nodes, artifacts: produced, dryRun: DRY_RUN };
}

export type MissionView = NonNullable<Awaited<ReturnType<typeof missionView>>>;

// ─── approvals, automations, memory, audit ──────────────────────────────────

export async function approvalsFor(operatorId: string, workspaceId?: string) {
  const spaces = (await myWorkspaces(operatorId)).filter((w) => !workspaceId || w.id === workspaceId);
  const rows = await Promise.all(
    spaces.map(async (workspace) => {
      const scoped = harness().store.scope(workspace.id);
      const [approvals, goals] = await Promise.all([scoped.list("approvals", { order: "desc", limit: 200 }), scoped.list("goals")]);
      const goalText = new Map(goals.map((g) => [g.id, g.text]));
      return approvals.map((approval) => ({ workspace, approval, goalText: approval.goalId ? (goalText.get(approval.goalId) ?? null) : null }));
    }),
  );
  return rows.flat().sort((a, b) => b.approval.createdAt.localeCompare(a.approval.createdAt));
}

export async function schedulesFor(operatorId: string, workspaceId?: string) {
  const spaces = (await myWorkspaces(operatorId)).filter((w) => !workspaceId || w.id === workspaceId);
  return (await Promise.all(spaces.map(async (workspace) => (await harness().schedules(workspace.id)).map((schedule) => ({ workspace, schedule }))))).flat();
}

export async function memoryFor(workspace: Workspace, kind?: string, q?: string) {
  const memory = harness().memory(workspace.id);
  const all = await memory.list();
  const kinds = Object.entries(all.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {})).sort((a, b) => a[0].localeCompare(b[0]));
  const items = q ? (await memory.retrieve(q, { kinds: kind ? [kind] : undefined, limit: 50 })).map((r) => r.item) : all.filter((i) => !kind || i.kind === kind).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { kinds, items, total: all.length };
}

export async function auditFor(workspace: Workspace) {
  const scoped = harness().store.scope(workspace.id);
  const [audit, checkpoints, goals] = await Promise.all([scoped.list("audit_log", { order: "desc", limit: 250 }), scoped.list("checkpoints", { order: "desc" }), scoped.list("goals")]);
  return { audit, checkpoints: checkpoints.map(({ snapshot, ...c }) => ({ ...c, providers: Object.keys(snapshot) })), goalText: new Map(goals.map((g) => [g.id, g.text])) };
}

export async function settingsFor(workspace: Workspace) {
  const tools = (await effectiveTools(harness().store.scope(workspace.id))).map(({ tool, enabled, requiresApproval }) => ({ name: tool.name, description: tool.description, effect: tool.effect, outbound: tool.outbound ?? null, owner: tool.owner ?? null, enabled, requiresApproval, ownApproval: tool.requiresApproval }));
  return { tools, agentTypes: listAgentTypes().map((a) => ({ type: a.type, description: a.description, scopes: a.scopes, tools: a.tools })) };
}

// ─── one lead's nurture (the sales lead page) ───────────────────────────────

/** The lead's archetype nurture in the operator's workspaces: its enrolment and the sequence-step approvals for it. */
export async function nurtureForLead(operatorId: string, leadId: string) {
  const key = `lead-${leadId}`;
  const rows = await Promise.all(
    (await myWorkspaces(operatorId)).map(async (workspace) => {
      const scoped = harness().store.scope(workspace.id);
      const enrolment = await scoped.get("memory_items", `enrolment:${key}`);
      const approvals = (await scoped.list("approvals", { order: "desc" })).filter((a) => a.tool === "sequence.sendStep" && (a.args as { leadKey?: string } | null)?.leadKey === key);
      return enrolment || approvals.length ? { workspace, enrolment, approvals } : null;
    }),
  );
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}

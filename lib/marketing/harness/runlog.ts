import "server-only";
import { audit } from "./trust";
import type { ScopedStore } from "./store";
import { TASK_STATUSES, type Approval, type Goal, type SubagentRun, type Task, type TaskStatus } from "./types";

/**
 * 7 · RUN LOG / TASK BOARD — per goal: its tasks with status (todo / doing /
 * done / blocked / failed), what each sub-agent did, and what's left. The
 * operator's view of an autonomous run.
 *
 * The run log is the ONE writer of task status: every change goes through
 * moveTask() and leaves an audit row, so the board and the trace agree.
 */

/** todo → doing, atomically: false = another worker already took it. */
export async function claimTask(scoped: ScopedStore, task: Task, actor: string, now: string): Promise<Task | null> {
  const claimed = await scoped.transition("tasks", task.id, ["todo"], { status: "doing", updatedAt: now });
  if (claimed) await audit(scoped, { kind: "task.status", actor, goalId: task.goalId, taskId: task.id, at: now, detail: `${task.title}: todo → doing` });
  return claimed;
}

export async function moveTask(scoped: ScopedStore, task: Task, to: TaskStatus, patch: { note?: string | null; output?: unknown }, actor: string, now: string): Promise<Task> {
  const next: Task = { ...task, status: to, note: patch.note !== undefined ? patch.note : task.note, output: patch.output !== undefined ? patch.output : task.output, updatedAt: now };
  await scoped.put("tasks", next);
  if (to !== task.status) await audit(scoped, { kind: "task.status", actor, goalId: task.goalId, taskId: task.id, at: now, detail: `${task.title}: ${task.status} → ${to}${next.note ? ` (${next.note})` : ""}` });
  return next;
}

export interface BoardRun {
  id: string;
  agentType: string;
  status: SubagentRun["status"];
  stopReason: SubagentRun["stopReason"];
  tainted: boolean;
  toolCalls: number;
  /** What the sub-agent did, step by step, in one line each. */
  did: string[];
  pendingApprovalId: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface BoardTask extends Pick<Task, "id" | "title" | "agentType" | "capability" | "status" | "note" | "dependsOn" | "parentTaskId" | "depth"> {
  runs: BoardRun[];
}

export interface GoalBoard {
  goal: Goal;
  tasks: BoardTask[];
  counts: Record<TaskStatus, number>;
  /** Tasks not done yet, with why. */
  left: { id: string; title: string; status: TaskStatus; why: string | null }[];
  pendingApprovals: Pick<Approval, "id" | "tool" | "summary" | "reasons" | "kind" | "createdAt" | "taskId">[];
}

const stepLine = (s: SubagentRun["steps"][number]): string => {
  switch (s.kind) {
    case "tool":
      return `${s.n}. ${s.tool} → ${s.outcome ?? "?"}${s.observation ? `: ${s.observation.slice(0, 160)}` : ""}`;
    case "finish":
      return `${s.n}. finished${s.observation ? `: ${s.observation.slice(0, 160)}` : ""}`;
    case "spawn":
      return `${s.n}. spawned sub-tasks${s.observation ? `: ${s.observation.slice(0, 160)}` : ""}`;
    case "blocked":
      return `${s.n}. blocked: ${s.observation ?? ""}`;
    default:
      return `${s.n}. ${s.observation ?? s.kind}`;
  }
};

export async function goalBoard(scoped: ScopedStore, goalId: string): Promise<GoalBoard | null> {
  const goal = await scoped.get("goals", goalId);
  if (!goal) return null;
  const [tasks, runs, approvals] = await Promise.all([
    scoped.list("tasks", { goalId }),
    scoped.list("subagent_runs", { goalId }),
    scoped.list("approvals", { goalId, status: "pending" }),
  ]);
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])) as Record<TaskStatus, number>;
  return {
    goal,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      agentType: t.agentType,
      capability: t.capability,
      status: t.status,
      note: t.note,
      dependsOn: t.dependsOn,
      parentTaskId: t.parentTaskId,
      depth: t.depth,
      runs: runs
        .filter((r) => r.taskId === t.id)
        .map((r) => ({ id: r.id, agentType: r.agentType, status: r.status, stopReason: r.stopReason, tainted: r.tainted, toolCalls: r.toolCalls, did: r.steps.map(stepLine), pendingApprovalId: r.pendingApprovalId, startedAt: r.startedAt, updatedAt: r.updatedAt })),
    })),
    counts,
    left: tasks.filter((t) => t.status !== "done").map((t) => ({ id: t.id, title: t.title, status: t.status, why: t.note })),
    pendingApprovals: approvals.map((a) => ({ id: a.id, tool: a.tool, summary: a.summary, reasons: a.reasons, kind: a.kind, createdAt: a.createdAt, taskId: a.taskId })),
  };
}

export const listGoals = (scoped: ScopedStore, limit = 50): Promise<Goal[]> => scoped.list("goals", { order: "desc", limit });

/** The board as plain text (logs, CLI, a notification body). */
export function renderBoard(board: GoalBoard): string {
  const mark: Record<TaskStatus, string> = { todo: "[ ]", doing: "[~]", done: "[x]", blocked: "[!]", failed: "[✗]" };
  const lines = [`GOAL ${board.goal.status.toUpperCase()}: ${board.goal.text}`, `  planner: ${board.goal.planner?.kind ?? "—"}${board.goal.planner?.model ? ` (${board.goal.planner.model})` : ""}${board.goal.planner?.note ? ` — ${board.goal.planner.note}` : ""}`];
  for (const t of board.tasks) {
    lines.push(`  ${"  ".repeat(t.depth)}${mark[t.status]} ${t.title} — ${t.agentType ?? `needs: ${t.capability ?? "unknown capability"}`}${t.note ? ` · ${t.note}` : ""}`);
    for (const r of t.runs) for (const d of r.did) lines.push(`  ${"  ".repeat(t.depth)}      ${d}`);
  }
  lines.push(`  ${TASK_STATUSES.map((s) => `${s} ${board.counts[s]}`).join(" · ")}${board.pendingApprovals.length ? ` · ${board.pendingApprovals.length} awaiting approval` : ""}`);
  return lines.join("\n");
}

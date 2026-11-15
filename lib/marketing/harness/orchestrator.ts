import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emit, notify } from "./automation";
import type { WorkspaceMemory } from "./memory";
import { claimTask, moveTask } from "./runlog";
import { resumeRun, startRun, type HarnessLlm, type RunOutcome } from "./runtime";
import type { HarnessStore, ScopedStore } from "./store";
import { effectiveTool, invoke, parseArgs } from "./tools";
import { audit, complianceCheck, containsUntrusted, decide, renderForModel, untrusted, UNTRUSTED_NOTICE, type Untrusted } from "./trust";
import type { Approval, Goal, GoalLimits, SubAgentType, Task, TaskSpec } from "./types";

/**
 * 3 · ORCHESTRATION — goal intake → PLANNER decomposes it into single tasks →
 * sub-agents are SPAWNED ON DEMAND, one run per task, by registered type →
 * independent tasks run as PARALLEL workstreams (waves over the dependency
 * graph, capped concurrency) → JOIN: the goal settles when nothing is
 * runnable — done, blocked (operator action needed) or failed.
 *
 * ── SEAM: how a feature adds a sub-agent type ────────────────────────────
 *   registerAgentType({
 *     type: "content", description: "Drafts on-brand copy from company memory",
 *     tools: ["draft_social_post", "search_memory"],   // registered tools
 *     scopes: ["memory:read", "content:write"],          // what its runs may do
 *     plan: (goal) => …,      // optional deterministic decomposition (no-model planning)
 *     after: ["content"],     // optional: its tasks wait for earlier tasks of these types
 *     decide: async (s) => …, // optional policy; default = model-driven over `tools`
 *     verify: (out) => …,     // optional join-time check
 *   });
 * Empty by design. The planner may name only registered types; anything it
 * wants that no type covers becomes a BLOCKED task naming the missing
 * capability — visible in the run log, never improvised.
 */

// ─── the sub-agent type registry ────────────────────────────────────────────

const g = globalThis as unknown as { __harnessAgents?: Map<string, SubAgentType> };
const agents = (): Map<string, SubAgentType> => (g.__harnessAgents ??= new Map());

export function registerAgentType(agent: SubAgentType, options: { replace?: boolean } = {}): SubAgentType {
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(agent.type)) throw new Error(`sub-agent type "${agent.type}" must be kebab-case`);
  if (agents().has(agent.type) && !options.replace) throw new Error(`sub-agent type "${agent.type}" is already registered`);
  agents().set(agent.type, agent);
  return agent;
}
export const unregisterAgentType = (type: string): void => void agents().delete(type);
export const getAgentType = (type: string): SubAgentType | undefined => agents().get(type);
export const listAgentTypes = (): SubAgentType[] => Array.from(agents().values());

// ─── context ────────────────────────────────────────────────────────────────

export const DEFAULT_LIMITS: GoalLimits = { maxTasks: 24, maxDepth: 2, maxConcurrency: 4 };

/** Everything orchestration needs for ONE workspace (built by index.ts). */
export interface WorkspaceContext {
  store: HarnessStore;
  scoped: ScopedStore;
  memory: WorkspaceMemory;
  llm: HarnessLlm;
  clock: () => string;
  limits: GoalLimits;
}

const runtimeDeps = (ctx: WorkspaceContext) => ({ store: ctx.store, scoped: ctx.scoped, memory: ctx.memory, llm: ctx.llm, clock: ctx.clock, agentTypes: listAgentTypes });

export class HarnessOff extends Error {
  override name = "HarnessOff";
  constructor() {
    super("The marketing harness is switched off for this workspace.");
  }
}

// ─── intake + planning ──────────────────────────────────────────────────────

export interface GoalInput {
  text: string;
  actor: string;
  /** "operator:<id>", "schedule:<id>", "event:<name>". */
  source: string;
  /** false = plan only. */
  execute: boolean;
  /** Third-party content that came with the goal (an event payload, a lead's message). Always untrusted. */
  attachments?: Untrusted[];
}

export async function submitGoal(ctx: WorkspaceContext, input: GoalInput): Promise<Goal> {
  const workspace = await ctx.store.getWorkspace(ctx.scoped.workspaceId);
  if (!workspace?.enabled) throw new HarnessOff();
  const now = ctx.clock();
  const goal: Goal = {
    id: `goal_${randomUUID()}`,
    workspaceId: ctx.scoped.workspaceId,
    text: input.text.trim().slice(0, 2000),
    status: "planning",
    source: input.source,
    actor: input.actor,
    planner: null,
    tainted: Boolean(input.attachments?.length),
    execute: input.execute,
    summary: null,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.scoped.put("goals", goal);
  await audit(ctx.scoped, { kind: "goal.submitted", actor: input.actor, goalId: goal.id, at: now, detail: goal.text, data: { source: input.source, execute: input.execute, tainted: goal.tainted } });
  for (const a of input.attachments ?? []) {
    if (a.flags.length) {
      await audit(ctx.scoped, { kind: "untrusted.flagged", actor: input.actor, goalId: goal.id, detail: `${a.source}: ${a.flags.join(", ")}` });
      await notify(ctx.scoped, { kind: "untrusted_flagged", title: "Suspicious third-party content", body: `${a.source} looked like it was trying to instruct the AI (${a.flags.join(", ")}). It was treated as data only.`, ref: goal.id });
    }
  }

  const planned = await plan(ctx, goal, input.attachments ?? []);
  const tasks = await createTasks(ctx, goal, planned.specs, null, 0);
  const next: Goal = { ...goal, status: "planned", planner: planned.planner, summary: `${tasks.length} task${tasks.length === 1 ? "" : "s"} planned`, updatedAt: ctx.clock() };
  await ctx.scoped.put("goals", next);
  await audit(ctx.scoped, { kind: "goal.planned", actor: "harness:planner", goalId: goal.id, detail: `${planned.planner.kind}: ${tasks.map((t) => t.title).join(" | ")}`, data: planned.planner });
  return next;
}

const PlanSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        agentType: z.string().nullable().optional(),
        capability: z.string().max(200).nullable().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
        dependsOn: z.array(z.number().int().min(0)).optional(),
      }),
    )
    .min(1)
    .max(12),
});

/** Model first (it only PROPOSES; the registry decides what's runnable), then the types' deterministic plans, then honest emptiness. */
async function plan(ctx: WorkspaceContext, goal: Goal, attachments: Untrusted[]): Promise<{ specs: TaskSpec[]; planner: NonNullable<Goal["planner"]> }> {
  const types = listAgentTypes();
  const r = await ctx.llm.completeJson({
    feature: "harness-planner",
    route: "harness-planner",
    system: [
      "You are the planner of a company's marketing harness. Decompose the operator's goal into 2–8 SINGLE, concrete tasks, in order.",
      'Assign each task to one of SUBAGENT_TYPES by its exact "type". If no type can do a task, set agentType to null and say in "capability" what would be needed.',
      'dependsOn lists the indexes (0-based) of tasks that must finish first; independent tasks get none so they can run in parallel.',
      "Humans own copy, offers, pricing and go-to-market: plan drafting, segmenting, scheduling and research — anything outbound (sending, publishing, ad spend, pricing, creative going live) is a task that ends in an approval request, never an automatic action.",
      'Reply as JSON: {"tasks":[{"title":"…","agentType":"<type>|null","capability":"…","input":{},"dependsOn":[0]}]}.',
      UNTRUSTED_NOTICE,
    ].join(" "),
    prompt: renderForModel({ GOAL: goal.text, SUBAGENT_TYPES: types.map((t) => ({ type: t.type, description: t.description })), ATTACHMENTS: attachments }),
    schema: PlanSchema,
    temperature: 0,
    maxTokens: 900,
    timeoutMs: 25_000,
  });
  if (r.ok) {
    const specs = r.data.tasks.map((t, i) => {
      const known = t.agentType && getAgentType(t.agentType) ? t.agentType : null;
      return {
        title: t.title,
        agentType: known,
        capability: known ? null : (t.capability ?? (t.agentType ? `a "${t.agentType}" sub-agent` : null) ?? "a capability no registered sub-agent has yet"),
        input: { ...(t.input ?? {}), ...(attachments.length ? { attachments } : {}) },
        dependsOn: (t.dependsOn ?? []).filter((d) => d < i),
      };
    });
    // A type's `after` holds for model plans too: its tasks also wait for EARLIER tasks of those types (no cycles).
    specs.forEach((spec, i) => {
      const after = spec.agentType ? (getAgentType(spec.agentType)?.after ?? []) : [];
      for (let j = 0; j < i; j++) if (specs[j].agentType && after.includes(specs[j].agentType!) && !spec.dependsOn.includes(j)) spec.dependsOn.push(j);
    });
    return { specs, planner: { kind: "llm", model: r.model, note: r.provider ? `provider ${r.provider}` : undefined } };
  }
  // Each type's plan indexes its own tasks; offset them into the combined list, and order types by their `after`.
  const fromTypes: TaskSpec[] = [];
  const startOf = new Map<string, number[]>();
  for (const t of types) {
    const own = t.plan?.(goal.text) ?? [];
    if (own.length === 0) continue;
    const offset = fromTypes.length;
    const waitFor = (t.after ?? []).flatMap((a) => startOf.get(a) ?? []);
    startOf.set(t.type, own.map((_, i) => offset + i));
    for (const s of own) fromTypes.push({ ...s, agentType: s.agentType ?? t.type, input: { ...(s.input ?? {}), ...(attachments.length ? { attachments } : {}) }, dependsOn: [...waitFor, ...(s.dependsOn ?? []).map((d) => d + offset)] });
  }
  if (fromTypes.length > 0) return { specs: fromTypes, planner: { kind: "rules", note: `no model plan (${r.reason}) — registered types' own plans` } };
  return {
    specs: [{ title: goal.text.slice(0, 200), agentType: null, capability: types.length ? "no registered sub-agent type planned for this goal" : "no sub-agent types are registered yet" }],
    planner: { kind: "none", note: `no model plan (${r.reason}) and no registered type planned for it` },
  };
}

async function createTasks(ctx: WorkspaceContext, goal: Goal, specs: TaskSpec[], parent: Task | null, depth: number): Promise<Task[]> {
  const existing = await ctx.scoped.list("tasks", { goalId: goal.id });
  const room = Math.max(0, ctx.limits.maxTasks - existing.length);
  const now = ctx.clock();
  const accepted = specs.slice(0, room);
  const ids = accepted.map(() => `task_${randomUUID()}`);
  const tasks: Task[] = accepted.map((s, i) => {
    const agentType = s.agentType && getAgentType(s.agentType) ? s.agentType : null;
    return {
      id: ids[i],
      workspaceId: ctx.scoped.workspaceId,
      goalId: goal.id,
      title: s.title.slice(0, 200),
      agentType,
      capability: agentType ? null : (s.capability ?? (s.agentType ? `a "${s.agentType}" sub-agent (not registered)` : "unassigned")),
      input: s.input ?? {},
      dependsOn: (s.dependsOn ?? []).filter((d) => d >= 0 && d < i).map((d) => ids[d]),
      parentTaskId: parent?.id ?? null,
      depth,
      status: agentType ? "todo" : "blocked",
      note: agentType ? null : `no registered sub-agent can do this yet — needs ${s.capability ?? "a capability"}`,
      output: null,
      createdAt: now,
      updatedAt: now,
    };
  });
  for (const t of tasks) await ctx.scoped.put("tasks", t);
  if (specs.length > accepted.length) await audit(ctx.scoped, { kind: "goal.limit", actor: "harness", goalId: goal.id, detail: `task limit ${ctx.limits.maxTasks} reached — ${specs.length - accepted.length} proposed task(s) dropped` });
  return tasks;
}

// ─── execution: parallel waves → join ───────────────────────────────────────

const lg = globalThis as unknown as { __harnessGoalLocks?: Map<string, { again: boolean }> };
const locks = () => (lg.__harnessGoalLocks ??= new Map());

/**
 * Runs a goal until nothing is runnable, then settles it. Safe to call
 * repeatedly (after an approval, from a schedule): one loop per goal per
 * process; a call during a loop makes it look again before settling.
 */
export async function runGoal(ctx: WorkspaceContext, goalId: string): Promise<Goal | null> {
  const key = `${ctx.scoped.workspaceId}/${goalId}`;
  const held = locks().get(key);
  if (held) {
    held.again = true;
    return ctx.scoped.get("goals", goalId);
  }
  const lock = { again: true };
  locks().set(key, lock);
  try {
    let goal = await ctx.scoped.transition("goals", goalId, ["planned", "blocked", "running"], { status: "running", updatedAt: ctx.clock() });
    if (!goal) return ctx.scoped.get("goals", goalId);
    await audit(ctx.scoped, { kind: "goal.running", actor: "harness", goalId, detail: goal.text });
    while (lock.again) {
      lock.again = false;
      await waves(ctx, goal);
    }
    goal = await settle(ctx, goalId);
    return goal;
  } finally {
    locks().delete(key);
  }
}

async function waves(ctx: WorkspaceContext, goal: Goal): Promise<void> {
  for (;;) {
    const workspace = await ctx.store.getWorkspace(ctx.scoped.workspaceId);
    const fresh = await ctx.scoped.get("goals", goal.id);
    if (!workspace?.enabled || !fresh || fresh.status === "cancelled") return;
    const tasks = await ctx.scoped.list("tasks", { goalId: goal.id });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks.filter((x) => x.status === "todo")) {
      const dead = t.dependsOn.map((d) => byId.get(d)).find((d) => d?.status === "failed");
      if (dead) await moveTask(ctx.scoped, t, "blocked", { note: `depends on "${dead.title}", which failed` }, "harness", ctx.clock());
    }
    const ready = tasks.filter((t) => t.status === "todo" && t.agentType && t.dependsOn.every((d) => byId.get(d)?.status === "done"));
    if (ready.length === 0) return;
    // A wave: up to maxConcurrency independent sub-agents at once.
    for (let i = 0; i < ready.length; i += ctx.limits.maxConcurrency) {
      await Promise.all(ready.slice(i, i + ctx.limits.maxConcurrency).map((t) => runTask(ctx, fresh, t)));
    }
  }
}

async function runTask(ctx: WorkspaceContext, goal: Goal, task: Task): Promise<void> {
  const claimed = await claimTask(ctx.scoped, task, "harness", ctx.clock());
  if (!claimed) return;
  const agent = claimed.agentType ? getAgentType(claimed.agentType) : undefined;
  if (!agent) {
    await moveTask(ctx.scoped, claimed, "blocked", { note: `sub-agent type "${claimed.agentType}" is no longer registered` }, "harness", ctx.clock());
    return;
  }
  const outcome = await startRun(runtimeDeps(ctx), goal, claimed, agent);
  await applyOutcome(ctx, goal, claimed, outcome);
}

async function applyOutcome(ctx: WorkspaceContext, goal: Goal, task: Task, outcome: RunOutcome): Promise<void> {
  const actor = `agent:${outcome.run.agentType}`;
  const now = ctx.clock();
  const current = (await ctx.scoped.get("tasks", task.id)) ?? task;
  switch (outcome.stop) {
    case "finished":
      await moveTask(ctx.scoped, current, "done", { note: outcome.summary, output: outcome.output }, actor, now);
      return;
    case "spawned": {
      const depth = current.depth + 1;
      if (depth > ctx.limits.maxDepth) {
        await moveTask(ctx.scoped, current, "failed", { note: `tried to split deeper than ${ctx.limits.maxDepth} levels` }, actor, now);
        return;
      }
      const children = await createTasks(ctx, goal, outcome.spawn ?? [], current, depth);
      await moveTask(ctx.scoped, current, "done", { note: `split into ${children.length} sub-task${children.length === 1 ? "" : "s"}`, output: { children: children.map((c) => c.id) } }, actor, now);
      return;
    }
    case "awaiting_approval":
      await moveTask(ctx.scoped, current, "blocked", { note: `awaiting approval: ${outcome.summary ?? ""}` }, actor, now);
      return;
    case "blocked":
    case "harness_off":
      await moveTask(ctx.scoped, current, "blocked", { note: outcome.summary }, actor, now);
      return;
    default:
      await moveTask(ctx.scoped, current, "failed", { note: `${outcome.stop}: ${outcome.summary ?? ""}` }, actor, now);
  }
}

/** JOIN: the goal's status from its tasks. */
async function settle(ctx: WorkspaceContext, goalId: string): Promise<Goal | null> {
  const goal = await ctx.scoped.get("goals", goalId);
  if (!goal || goal.status === "cancelled") return goal;
  const tasks = await ctx.scoped.list("tasks", { goalId });
  const n = (s: Task["status"]) => tasks.filter((t) => t.status === s).length;
  const status: Goal["status"] = tasks.length > 0 && n("done") === tasks.length ? "done" : n("blocked") + n("todo") + n("doing") > 0 ? "blocked" : "failed";
  const summary = `${n("done")}/${tasks.length} done${n("blocked") ? ` · ${n("blocked")} blocked` : ""}${n("failed") ? ` · ${n("failed")} failed` : ""}${n("todo") ? ` · ${n("todo")} waiting` : ""}`;
  const next = await ctx.scoped.transition("goals", goalId, ["running"], { status, summary, updatedAt: ctx.clock() });
  if (!next) return ctx.scoped.get("goals", goalId);
  await audit(ctx.scoped, { kind: `goal.${status}`, actor: "harness", goalId, detail: summary });
  await notify(ctx.scoped, { kind: status === "done" ? "goal_finished" : "goal_blocked", title: status === "done" ? "Goal finished" : status === "failed" ? "Goal failed" : "Goal needs you", body: `${goal.text} — ${summary}`, ref: goalId });
  // A goal an event started never raises goal.* events itself — no trigger chains.
  if (!goal.source.startsWith("event:")) await emit(ctx.store, ctx.scoped.workspaceId, `goal.${status}`, { goalId });
  return next;
}

export async function cancelGoal(ctx: WorkspaceContext, goalId: string, actor: string): Promise<Goal | null> {
  const goal = await ctx.scoped.transition("goals", goalId, ["planning", "planned", "running", "blocked"], { status: "cancelled", summary: `cancelled by ${actor}`, updatedAt: ctx.clock() });
  if (!goal) return null;
  for (const a of await ctx.scoped.list("approvals", { goalId, status: "pending" })) await ctx.scoped.transition("approvals", a.id, ["pending"], { status: "expired", note: "goal cancelled", decidedAt: ctx.clock() });
  for (const t of await ctx.scoped.list("tasks", { goalId, status: ["todo", "blocked"] })) await moveTask(ctx.scoped, t, "failed", { note: "goal cancelled" }, actor, ctx.clock());
  await audit(ctx.scoped, { kind: "goal.cancelled", actor, goalId, detail: goal.text });
  return goal;
}

// ─── approval decisions → execute (once) → resume the paused run ────────────

export interface DecisionResult {
  approval: Approval;
  executed: { ok: boolean; observation: string } | null;
  /** Resumes the paused run and the goal; the API lets it finish in the background, tests await it. */
  continuation: Promise<void>;
}

export async function decideApproval(ctx: WorkspaceContext, approvalId: string, decision: "approve" | "decline", actor: string, note: string | null): Promise<DecisionResult | null> {
  const resolved = await decide(ctx.scoped, approvalId, decision, actor, note, ctx.clock());
  if (!resolved) return null;
  let executed: DecisionResult["executed"] = null;
  if (decision === "approve") {
    executed = await executeApproved(ctx, resolved, actor);
    await ctx.scoped.put("approvals", { ...resolved, result: executed });
  }
  // Generic signal for features that care how a gated action ended (e.g. a nurture step marked done / declined).
  await emit(ctx.store, ctx.scoped.workspaceId, "approval.decided", { approvalId, tool: resolved.tool, decision, actor, args: resolved.args as Record<string, unknown>, executed });
  const observation =
    decision === "approve"
      ? `operator ${actor} approved ${resolved.tool}; ${executed?.ok ? `it ran: ${executed.observation}` : `it did not run: ${executed?.observation}`}`
      : `operator ${actor} declined ${resolved.tool}${note ? `: "${note}"` : ""} — do not retry it as is`;
  const continuation = (async () => {
    if (!resolved.runId) return;
    const run = await ctx.scoped.get("subagent_runs", resolved.runId);
    const agent = run ? getAgentType(run.agentType) : undefined;
    const goal = resolved.goalId ? await ctx.scoped.get("goals", resolved.goalId) : null;
    const task = resolved.taskId ? await ctx.scoped.get("tasks", resolved.taskId) : null;
    if (!run || !agent || !goal || !task || goal.status === "cancelled") return;
    const doing = await ctx.scoped.transition("tasks", task.id, ["blocked"], { status: "doing", note: null, updatedAt: ctx.clock() });
    if (!doing) return;
    const outcome = await resumeRun(runtimeDeps(ctx), run.id, observation, agent);
    if (outcome) await applyOutcome(ctx, goal, doing, outcome);
    if (goal.execute) await runGoal(ctx, goal.id);
  })().catch((error) => console.warn(`[harness] resume after ${approvalId} failed: ${error instanceof Error ? error.message : error}`));
  return { approval: { ...resolved, result: executed }, executed, continuation };
}

/** Runs an approved call — re-checked first: the tool still exists and is enabled, the harness is on, and what ships still passes RERA + AI label. */
async function executeApproved(ctx: WorkspaceContext, approval: Approval, actor: string): Promise<{ ok: boolean; observation: string }> {
  const workspace = await ctx.store.getWorkspace(ctx.scoped.workspaceId);
  if (!workspace?.enabled) return { ok: false, observation: "the harness is switched off — nothing was run" };
  const eff = await effectiveTool(ctx.scoped, approval.tool);
  if (!eff || !eff.enabled) return { ok: false, observation: `tool ${approval.tool} is no longer available — nothing was run` };
  const parsed = parseArgs(eff.tool, approval.args);
  if (!parsed.ok) return { ok: false, observation: `arguments no longer valid: ${parsed.error}` };
  const compliance = complianceCheck(eff.tool.effect, eff.tool.outbound ?? null, eff.tool.ships ? eff.tool.ships(parsed.input) : []);
  if (!compliance.ok) return { ok: false, observation: `blocked at execution: ${compliance.problems.join("; ")}` };
  const result = await invoke(eff.tool, parsed.input, { workspaceId: ctx.scoped.workspaceId, goalId: approval.goalId, taskId: approval.taskId, runId: approval.runId, actor, now: ctx.clock(), memory: ctx.memory, workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] }, approvalId: approval.id });
  await audit(ctx.scoped, { kind: result.ok ? "tool.executed" : "tool.failed", actor, goalId: approval.goalId, taskId: approval.taskId, runId: approval.runId, detail: `${approval.tool} (${eff.tool.effect}) after approval ${approval.id}${result.ok ? "" : `: ${result.error}`}` });
  await notify(ctx.scoped, { kind: "action_executed", title: result.ok ? "Approved action ran" : "Approved action failed", body: `${approval.summary} — ${result.ok ? result.observation.slice(0, 300) : result.error}`, ref: approval.id });
  if (!result.ok) return { ok: false, observation: result.error };
  return { ok: true, observation: eff.tool.untrustedOutput ? `[untrusted output] ${result.observation}` : result.observation };
}

/** Wraps third-party content for goal attachments (re-exported for callers). */
export const attachUntrusted = (text: string, source: string): Untrusted => untrusted(text, source);
export { containsUntrusted };

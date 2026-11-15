import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { completeJson } from "../../llm";
import { notify } from "./automation";
import type { WorkspaceMemory } from "./memory";
import type { HarnessStore, ScopedStore } from "./store";
import { effectiveTool, effectiveTools, invoke, parseArgs } from "./tools";
import { audit, complianceCheck, containsUntrusted, gate, renderForModel, requestApproval, untrusted, UNTRUSTED_NOTICE, fenceUntrusted } from "./trust";
import type { Budget, Decision, Goal, PolicyState, RunStep, StopReason, SubAgentType, SubagentRun, Task, TaskSpec } from "./types";

/**
 * 1 · AGENT RUNTIME — one sub-agent run: PLAN (the policy decides the next
 * step) → ACT (a tool call, through the trust gate) → OBSERVE (the result is
 * appended to the run) → repeat, until a stopping condition:
 *
 *   finished · spawned (handed sub-tasks to the orchestrator) · blocked (the
 *   policy can't proceed) · awaiting_approval (the gate paused it — resumed by
 *   resumeRun() once the operator decides) · max_steps · budget_tool_calls ·
 *   budget_time · repeated_action (same call 3× in a row) · error_streak
 *   (N failed calls in a row) · harness_off · cancelled · error.
 *
 * The runtime knows nothing about marketing. The POLICY is the sub-agent
 * type's own decide(), or — when a type doesn't bring one — the model-driven
 * policy below, which goes through lib/llm (any provider; route
 * "harness-agent") and may only pick a listed tool. The run's whole state
 * lives in subagent_runs, so a run survives restarts and approval pauses.
 */

export const DEFAULT_BUDGET: Budget = { maxSteps: 12, maxToolCalls: 8, maxMs: 120_000, maxErrorStreak: 3 };

/** The model seam the runtime and planner use (lib/llm by default; tests inject a scripted one). */
export interface HarnessLlm {
  completeJson: typeof completeJson;
}

export interface RuntimeDeps {
  store: HarnessStore;
  scoped: ScopedStore;
  memory: WorkspaceMemory;
  llm: HarnessLlm;
  clock: () => string;
  /** The registered sub-agent types (for spawn proposals). */
  agentTypes: () => SubAgentType[];
}

export interface RunOutcome {
  run: SubagentRun;
  stop: StopReason;
  summary: string | null;
  output: unknown;
  spawn: TaskSpec[] | null;
}

const RUN_STATUS: Record<StopReason, SubagentRun["status"]> = {
  finished: "done",
  spawned: "done",
  awaiting_approval: "waiting",
  blocked: "blocked",
  harness_off: "blocked",
  max_steps: "failed",
  budget_tool_calls: "failed",
  budget_time: "failed",
  repeated_action: "failed",
  error_streak: "failed",
  cancelled: "failed",
  error: "failed",
};

export async function startRun(deps: RuntimeDeps, goal: Goal, task: Task, agent: SubAgentType): Promise<RunOutcome> {
  const now = deps.clock();
  const run: SubagentRun = {
    id: `run_${randomUUID()}`,
    workspaceId: deps.scoped.workspaceId,
    goalId: goal.id,
    taskId: task.id,
    agentType: agent.type,
    status: "running",
    stopReason: null,
    steps: [],
    tainted: goal.tainted || containsUntrusted(task.input),
    pendingApprovalId: null,
    output: null,
    toolCalls: 0,
    elapsedMs: 0,
    startedAt: now,
    updatedAt: now,
  };
  await deps.scoped.put("subagent_runs", run);
  await audit(deps.scoped, { kind: "subagent.spawned", actor: `agent:${agent.type}`, goalId: goal.id, taskId: task.id, runId: run.id, at: now, detail: `${agent.type} took "${task.title}"${run.tainted ? " (tainted: untrusted input)" : ""}` });
  return loop(deps, run, goal, task, agent);
}

/** Continues a run paused on an approval, with what happened to it as the next observation. */
export async function resumeRun(deps: RuntimeDeps, runId: string, observation: string, agent: SubAgentType): Promise<RunOutcome | null> {
  const run = await deps.scoped.transition("subagent_runs", runId, ["waiting"], { status: "running", pendingApprovalId: null, updatedAt: deps.clock() });
  if (!run) return null;
  const [goal, task] = await Promise.all([deps.scoped.get("goals", run.goalId), deps.scoped.get("tasks", run.taskId)]);
  if (!goal || !task) return null;
  run.steps.push({ n: run.steps.length + 1, at: deps.clock(), kind: "observation", observation });
  return loop(deps, run, goal, task, agent);
}

async function loop(deps: RuntimeDeps, run: SubagentRun, goal: Goal, task: Task, agent: SubAgentType): Promise<RunOutcome> {
  const budget: Budget = { ...DEFAULT_BUDGET, ...agent.budget };
  const sliceStart = Date.now();
  let errorStreak = 0;
  const elapsed = () => run.elapsedMs + (Date.now() - sliceStart);
  const step = async (s: Omit<RunStep, "n" | "at">) => {
    const full: RunStep = { n: run.steps.length + 1, at: deps.clock(), ...s };
    run.steps.push(full);
    run.updatedAt = full.at;
    await deps.scoped.put("subagent_runs", { ...run, elapsedMs: elapsed() });
    await audit(deps.scoped, { kind: "run.step", actor: `agent:${agent.type}`, goalId: goal.id, taskId: task.id, runId: run.id, at: full.at, detail: `${full.kind}${full.tool ? ` ${full.tool}` : ""}${full.outcome ? ` → ${full.outcome}` : ""}${full.observation ? `: ${full.observation.slice(0, 200)}` : ""}`, data: { step: full.n, thought: full.thought ?? null } });
  };
  const stop = async (reason: StopReason, extra: { summary?: string; output?: unknown; spawn?: TaskSpec[] } = {}): Promise<RunOutcome> => {
    run.status = RUN_STATUS[reason];
    run.stopReason = reason;
    run.elapsedMs = elapsed();
    if (extra.output !== undefined) run.output = extra.output;
    run.updatedAt = deps.clock();
    await deps.scoped.put("subagent_runs", run);
    await audit(deps.scoped, { kind: "run.stopped", actor: `agent:${agent.type}`, goalId: goal.id, taskId: task.id, runId: run.id, at: run.updatedAt, detail: `${reason}${extra.summary ? `: ${extra.summary}` : ""}` });
    return { run, stop: reason, summary: extra.summary ?? null, output: extra.output ?? null, spawn: extra.spawn ?? null };
  };
  const actions = () => run.steps.filter((s) => s.kind !== "observation").length;

  try {
    for (;;) {
      // ── stopping conditions checked before every step ──
      const workspace = await deps.store.getWorkspace(deps.scoped.workspaceId);
      if (!workspace?.enabled) return stop("harness_off", { summary: "the harness was switched off" });
      const fresh = await deps.scoped.get("goals", goal.id);
      if (fresh?.status === "cancelled") return stop("cancelled", { summary: "the goal was cancelled" });
      if (actions() >= budget.maxSteps) return stop("max_steps", { summary: `stopped after ${budget.maxSteps} steps` });
      if (elapsed() >= budget.maxMs) return stop("budget_time", { summary: `stopped after ${Math.round(budget.maxMs / 1000)} s` });

      // ── PLAN ──
      const available = (await effectiveTools(deps.scoped)).filter((t) => t.enabled && agent.tools.includes(t.tool.name));
      const state: PolicyState = {
        workspaceId: deps.scoped.workspaceId,
        workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] },
        goal: { id: goal.id, text: goal.text },
        task: { id: task.id, title: task.title, input: task.input },
        steps: run.steps,
        tools: available.map(({ tool, requiresApproval }) => ({ name: tool.name, description: tool.description, effect: tool.effect, requiresApproval })),
        memory: deps.memory,
      };
      const decision: Decision = agent.decide ? await agent.decide(state) : await modelPolicy(deps, agent, state);

      // ── ACT / OBSERVE ──
      if (decision.kind === "finish") {
        const verdict = agent.verify?.(decision.output);
        if (verdict && !verdict.ok) {
          await step({ kind: "observation", observation: `output rejected by verify: ${verdict.problems.join("; ")}` });
          errorStreak += 1;
          if (errorStreak >= budget.maxErrorStreak) return stop("error_streak", { summary: verdict.problems.join("; ") });
          continue;
        }
        await step({ kind: "finish", observation: decision.summary });
        return stop("finished", { summary: decision.summary, output: decision.output });
      }
      if (decision.kind === "blocked") {
        await step({ kind: "blocked", observation: decision.reason });
        return stop("blocked", { summary: decision.reason });
      }
      if (decision.kind === "spawn") {
        const tasks = decision.tasks.slice(0, 8);
        await step({ kind: "spawn", thought: decision.thought, observation: tasks.map((t) => t.title).join(" | ") });
        return stop("spawned", { summary: `split into ${tasks.length} sub-task${tasks.length === 1 ? "" : "s"}`, spawn: tasks, output: { spawned: tasks.map((t) => t.title) } });
      }

      // decision.kind === "tool"
      if (run.toolCalls >= budget.maxToolCalls) return stop("budget_tool_calls", { summary: `stopped after ${budget.maxToolCalls} tool calls` });
      const signature = JSON.stringify([decision.tool, decision.args ?? {}]);
      const lastTwo = run.steps.filter((s) => s.kind === "tool").slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((s) => JSON.stringify([s.tool, s.args ?? {}]) === signature)) {
        return stop("repeated_action", { summary: `${decision.tool} proposed 3 times in a row with the same arguments` });
      }
      const failed = async (outcome: "denied" | "error", observation: string) => {
        await step({ kind: "tool", tool: decision.tool, args: decision.args, thought: decision.thought, outcome, observation });
        errorStreak += 1;
        return errorStreak >= budget.maxErrorStreak ? stop("error_streak", { summary: `${errorStreak} failed actions in a row — last: ${observation}` }) : null;
      };

      const eff = await effectiveTool(deps.scoped, decision.tool);
      if (!eff || !agent.tools.includes(decision.tool)) {
        const s = await failed("denied", `tool ${decision.tool} is not available to ${agent.type}`);
        if (s) return s;
        continue;
      }
      const parsed = parseArgs(eff.tool, decision.args);
      if (!parsed.ok) {
        const s = await failed("error", `invalid arguments: ${parsed.error}`);
        if (s) return s;
        continue;
      }
      const verdict = gate({ workspace, tool: eff, scopes: agent.scopes, tainted: run.tainted });
      if (verdict.kind === "deny") {
        const s = await failed("denied", verdict.reason);
        if (s) return s;
        continue;
      }
      const ships = eff.tool.ships ? eff.tool.ships(parsed.input) : [];
      const compliance = complianceCheck(eff.tool.effect, eff.tool.outbound ?? null, ships);
      if (!compliance.ok) {
        const s = await failed("denied", `cannot ship: ${compliance.problems.join("; ")}`);
        if (s) return s;
        continue;
      }
      if (verdict.kind === "approval") {
        const approval = await requestApproval(deps.scoped, { goalId: goal.id, taskId: task.id, runId: run.id, tool: eff, args: parsed.input, reasons: verdict.reasons, kind: verdict.approvalKind, requestedBy: `agent:${agent.type}`, ships, now: deps.clock() });
        await step({ kind: "tool", tool: decision.tool, args: parsed.input, thought: decision.thought, outcome: "approval", approvalId: approval.id, observation: `waiting for operator approval — ${verdict.reasons.join("; ")}` });
        run.pendingApprovalId = approval.id;
        await notify(deps.scoped, { kind: "approval_needed", title: approval.kind === "suggestion" ? "Suggestion to review" : "Approval needed", body: approval.summary, ref: approval.id });
        return stop("awaiting_approval", { summary: approval.summary });
      }

      const result = await invoke(eff.tool, parsed.input, { workspaceId: deps.scoped.workspaceId, goalId: goal.id, taskId: task.id, runId: run.id, actor: `agent:${agent.type}`, now: deps.clock(), memory: deps.memory, workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] } });
      run.toolCalls += 1;
      if (!result.ok) {
        const s = await failed("error", result.error);
        if (s) return s;
        continue;
      }
      errorStreak = 0;
      let observation = result.observation;
      if (eff.tool.untrustedOutput) {
        run.tainted = true;
        observation = fenceUntrusted(untrusted(observation, `tool:${eff.tool.name}`));
      }
      await step({ kind: "tool", tool: decision.tool, args: parsed.input, thought: decision.thought, outcome: "executed", observation, ms: result.ms });
      await audit(deps.scoped, { kind: "tool.executed", actor: `agent:${agent.type}`, goalId: goal.id, taskId: task.id, runId: run.id, detail: `${eff.tool.name} (${eff.tool.effect})`, data: { ms: result.ms } });
    }
  } catch (error) {
    return stop("error", { summary: error instanceof Error ? error.message : "run failed" });
  }
}

// ─── the model-driven policy (for types without their own decide()) ─────────

const ModelDecision = z.object({
  action: z.enum(["tool", "finish", "spawn", "blocked"]),
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  thought: z.string().max(400).optional(),
  summary: z.string().max(600).optional(),
  output: z.unknown().optional(),
  tasks: z.array(z.object({ title: z.string().min(3).max(200), agentType: z.string().nullable().optional(), input: z.record(z.string(), z.unknown()).optional() })).max(8).optional(),
  reason: z.string().max(400).optional(),
});

async function modelPolicy(deps: RuntimeDeps, agent: SubAgentType, state: PolicyState): Promise<Decision> {
  const memory = (await deps.memory.retrieve(`${state.goal.text} ${state.task.title}`, { limit: 5 })).map(({ item }) => ({
    kind: item.kind,
    title: item.title,
    text: item.trust === "untrusted" ? untrusted(item.text, `memory:${item.id}`) : item.text.slice(0, 600),
  }));
  const system = [
    `You are the "${agent.type}" sub-agent of a company's marketing harness. ${agent.instructions ?? agent.description}`,
    'Reply with ONE next step as JSON: {"action":"tool","tool":"<name>","args":{…},"thought":"…"} | {"action":"finish","summary":"…","output":{…}} | {"action":"spawn","tasks":[{"title":"…","agentType":"<type>","input":{}}]} | {"action":"blocked","reason":"…"}.',
    "Use only the listed tools. Humans own copy, offers, pricing and go-to-market: anything outbound is reviewed by a person — you never publish, send, spend or set prices yourself, and you never invent prices, numbers or claims.",
    "Finish as soon as the task is done. If no listed tool can do it, reply blocked with the reason.",
    UNTRUSTED_NOTICE,
  ].join(" ");
  const prompt = renderForModel({
    GOAL: state.goal.text,
    TASK: { title: state.task.title, input: state.task.input },
    TOOLS: state.tools,
    SUBAGENT_TYPES: deps.agentTypes().map((t) => ({ type: t.type, description: t.description })),
    STEPS_SO_FAR: state.steps.slice(-8).map((s) => ({ kind: s.kind, tool: s.tool, outcome: s.outcome, observation: s.observation?.slice(0, 600) })),
    COMPANY_MEMORY: memory,
  });
  const r = await deps.llm.completeJson({ feature: `harness-agent:${agent.type}`, route: "harness-agent", system, prompt, schema: ModelDecision, temperature: 0, maxTokens: 500, timeoutMs: 20_000 });
  if (!r.ok) return { kind: "blocked", reason: `no usable model decision (${r.reason}) and ${agent.type} has no deterministic policy` };
  const d = r.data;
  switch (d.action) {
    case "tool":
      return d.tool ? { kind: "tool", tool: d.tool, args: d.args ?? {}, thought: d.thought } : { kind: "blocked", reason: "model chose a tool action without naming a tool" };
    case "finish":
      return { kind: "finish", summary: d.summary ?? "done", output: d.output ?? null };
    case "spawn":
      return d.tasks?.length ? { kind: "spawn", tasks: d.tasks.map((t) => ({ title: t.title, agentType: t.agentType ?? null, input: t.input })), thought: d.thought } : { kind: "blocked", reason: "model asked to spawn no tasks" };
    default:
      return { kind: "blocked", reason: d.reason ?? "model reported it is blocked" };
  }
}

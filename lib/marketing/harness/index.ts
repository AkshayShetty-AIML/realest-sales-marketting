import "server-only";
import { randomUUID } from "node:crypto";
import { harnessStubsEnabled } from "../../env";
import { completeJson } from "../../llm";
import * as automation from "./automation";
import { workspaceMemory, type WorkspaceMemory } from "./memory";
import * as orchestrator from "./orchestrator";
import { goalBoard, listGoals } from "./runlog";
import type { HarnessLlm } from "./runtime";
import { harnessStore, type HarnessStore } from "./store";
import { audit, createCheckpoint, restoreCheckpoint, untrusted } from "./trust";
import type { AutonomyLevel, GoalLimits, Workspace } from "./types";
import { registerHarnessStubs } from "./stubs";
import { registerFeatures } from "./features";

/**
 * THE MARKETING AGENTIC HARNESS — the spine, wired. FEATURE-EMPTY: no tool,
 * no sub-agent type and no business logic lives here. Seven separate,
 * replaceable modules:
 *
 *   1 runtime.ts       the plan → act → observe loop, stop conditions, budgets
 *   2 memory.ts        company memory (workspace-scoped) + retrieval seam
 *   3 orchestrator.ts  goal intake → planner → on-demand sub-agents → parallel waves → join; sub-agent TYPE registry
 *   4 tools.ts         tool registry (approval flag, scopes, effect), per-workspace settings, MCP adapter
 *   5 automation.ts    cron schedules, event triggers, notifications — every firing goes through goal intake
 *   6 trust.ts         approval gate, RERA + AI label, audit trail, checkpoints/rollback, scopes, untrusted input
 *   7 runlog.ts        per-goal task board: todo / doing / done / blocked / failed, what each sub-agent did, what's left
 *
 * plus store.ts (workspace-scoped persistence) and types.ts (the contracts).
 * Model calls go through lib/llm (provider routing + fallback; routes
 * "harness-planner" and "harness-agent").
 *
 * ── REGISTRATION SEAMS (how a feature plugs in) ─────────────────────────
 *   registerTool(def)                tools.ts        a callable tool (effect, scopes, approval, ships)
 *   registerAgentType(def)           orchestrator.ts a sub-agent type (its tools, scopes, policy, plan, verify)
 *   registerMcpServer(name, client)  tools.ts        remote MCP tools, each declared before use
 *   registerSnapshotProvider(p)      trust.ts        feature state that checkpoints capture / restore
 *   registerNotifier(n)              automation.ts   another notification channel
 *   onEvent(name, fn) / emit(...)    automation.ts   feature events (and event-triggered schedules)
 *   setRetriever(r)                  memory.ts       swap lexical retrieval for embeddings
 * Features register through lib/marketing/harness/features.ts (the one
 * place the spine is told about them) — today M1–M3, lib/marketing/agents.
 * See docs/MARKETING_HARNESS.md for a worked example.
 */

export interface HarnessOptions {
  store?: HarnessStore;
  llm?: HarnessLlm;
  clock?: () => string;
  limits?: Partial<GoalLimits>;
}

export class NotFound extends Error {
  override name = "NotFound";
}

export class DeleteRefused extends Error {
  override name = "DeleteRefused";
}

export class ProjectTaken extends Error {
  override name = "ProjectTaken";
  constructor(propertyId: string, workspace: string) {
    super(`"${propertyId}" already sends its leads to the workspace "${workspace}".`);
  }
}

export class LinkTaken extends Error {
  override name = "LinkTaken";
  constructor(builderId: string) {
    super(`Another workspace is already linked to "${builderId}".`);
  }
}

export function createHarness(options: HarnessOptions = {}) {
  const store = options.store ?? harnessStore();
  const llm: HarnessLlm = options.llm ?? { completeJson };
  const clock = options.clock ?? (() => new Date().toISOString());
  const limits: GoalLimits = { ...orchestrator.DEFAULT_LIMITS, ...options.limits };
  /** Background goal runs (API and schedules don't wait; tests do). */
  const background = new Set<Promise<unknown>>();
  const track = (p: Promise<unknown>) => {
    const t = p.catch((error) => console.warn(`[harness] background run failed: ${error instanceof Error ? error.message : error}`)).finally(() => background.delete(t));
    background.add(t);
  };

  /** One workspace's context: scoped store + memory. Everything below goes through it. */
  function context(workspaceId: string): orchestrator.WorkspaceContext {
    const scoped = store.scope(workspaceId);
    return { store, scoped, memory: workspaceMemory(scoped, clock), llm, clock, limits };
  }

  /** A workspace may be LINKED to an external tenant (the premium spine's builder) — never two workspaces to the same one. */
  async function assertLinkFree(builderId: string | null | undefined, self: string | null): Promise<void> {
    if (!builderId) return;
    const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
    const taken = (await store.listWorkspaces()).find((w) => w.builderId && norm(w.builderId) === norm(builderId) && w.id !== self);
    if (taken) throw new LinkTaken(builderId);
  }

  async function requireWorkspace(id: string): Promise<Workspace> {
    const ws = await store.getWorkspace(id);
    if (!ws) throw new NotFound("workspace not found");
    return ws;
  }

  const runInBackground = (workspaceId: string, goalId: string) => track(orchestrator.runGoal(context(workspaceId), goalId));

  // Schedules and events reach goals only through here: same intake, same gate.
  automation.setGoalRunner(store, async (workspaceId, g) => {
    try {
      const goal = await orchestrator.submitGoal(context(workspaceId), { text: g.text, actor: g.actor, source: g.source, execute: !g.plannedOnly, attachments: g.attachments });
      if (goal.execute) runInBackground(workspaceId, goal.id);
      return { goalId: goal.id };
    } catch (error) {
      if (error instanceof orchestrator.HarnessOff) return { skipped: error.message };
      throw error;
    }
  });

  return {
    store,
    context,
    memory: (workspaceId: string): WorkspaceMemory => context(workspaceId).memory,
    /** Resolves when every background run started so far has finished (tests, scripts). */
    settled: async () => {
      while (background.size) await Promise.all(Array.from(background));
    },

    // ── workspaces: on/off + autonomy ──
    async createWorkspace(input: { name: string; members: string[]; builderId?: string | null; timezone?: string; actor: string; enabled?: boolean; autonomy?: AutonomyLevel; demo?: boolean }): Promise<Workspace> {
      await assertLinkFree(input.builderId, null);
      const now = clock();
      const ws: Workspace = {
        id: `ws_${randomUUID()}`,
        name: input.name.trim().slice(0, 120) || "Workspace",
        // Safe defaults: OFF and suggest-only until an operator turns it up.
        enabled: input.enabled ?? false,
        autonomy: input.autonomy ?? "suggest-only",
        members: Array.from(new Set(input.members)),
        builderId: input.builderId ?? null,
        timezone: input.timezone ?? "Asia/Kolkata",
        ...(input.demo ? { demo: true } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await store.putWorkspace(ws);
      await audit(store.scope(ws.id), { kind: "workspace.created", actor: input.actor, detail: `${ws.name} (${ws.enabled ? "on" : "off"}, ${ws.autonomy})` });
      return ws;
    },
    async updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "enabled" | "autonomy" | "members" | "timezone" | "builderId" | "projects" | "autoFirstReply">>, actor: string): Promise<Workspace> {
      const ws = await requireWorkspace(id);
      await assertLinkFree(patch.builderId, id);
      if (patch.projects) {
        // A building's leads go to exactly ONE workspace.
        const others = (await store.listWorkspaces()).filter((w) => w.id !== id);
        const taken = patch.projects.find((p) => others.some((w) => (w.projects ?? []).includes(p)));
        if (taken) throw new ProjectTaken(taken, others.find((w) => (w.projects ?? []).includes(taken))!.name);
        patch = { ...patch, projects: Array.from(new Set(patch.projects)) };
      }
      // Only the keys actually given — an absent field must never blank the stored one.
      const given = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as typeof patch;
      const next: Workspace = { ...ws, ...given, updatedAt: clock() };
      await store.putWorkspace(next);
      const changes = (["enabled", "autonomy", "name", "members", "timezone", "builderId", "projects", "autoFirstReply"] as const).filter((k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(ws[k]));
      if (changes.length) await audit(store.scope(id), { kind: "workspace.settings", actor, detail: changes.map((k) => `${k}: ${JSON.stringify(ws[k])} → ${JSON.stringify(next[k])}`).join("; ") });
      return next;
    },
    getWorkspace: (id: string) => store.getWorkspace(id),
    /**
     * Deletes a workspace and everything it owns. Only when it is switched OFF
     * and no sub-agent is mid-run (so nothing writes into it afterwards), and
     * only with its exact name as confirmation. Irreversible — its own audit
     * trail goes with it, so the deletion is logged on the server.
     */
    async deleteWorkspace(id: string, confirmName: string, actor: string): Promise<void> {
      const ws = await requireWorkspace(id);
      if (confirmName.trim() !== ws.name) throw new DeleteRefused("Type the workspace's exact name to confirm.");
      if (ws.enabled) throw new DeleteRefused("Switch the workspace off first, so no agent starts while it is being deleted.");
      const busy = await store.scope(id).list("subagent_runs", { status: "running" });
      if (busy.length) throw new DeleteRefused(`${busy.length} agent run${busy.length === 1 ? " is" : "s are"} still finishing — try again in a moment.`);
      await store.deleteWorkspace(id);
      console.info(`[harness] workspace ${id} ("${ws.name}") deleted by ${actor}`);
    },
    /** Only the workspaces this operator is a member of. */
    workspacesFor: async (operatorId: string) => (await store.listWorkspaces()).filter((w) => w.members.includes(operatorId)),

    // ── goals ──
    async submitGoal(workspaceId: string, input: { text: string; actor: string; execute?: boolean; untrustedAttachments?: { text: string; source: string }[] }) {
      await requireWorkspace(workspaceId);
      const goal = await orchestrator.submitGoal(context(workspaceId), {
        text: input.text,
        actor: input.actor,
        source: `operator:${input.actor}`,
        execute: input.execute ?? true,
        attachments: (input.untrustedAttachments ?? []).map((a) => untrusted(a.text, a.source)),
      });
      if (goal.execute) runInBackground(workspaceId, goal.id);
      return goal;
    },
    runGoal: (workspaceId: string, goalId: string) => orchestrator.runGoal(context(workspaceId), goalId),
    startGoal: (workspaceId: string, goalId: string) => runInBackground(workspaceId, goalId),
    cancelGoal: (workspaceId: string, goalId: string, actor: string) => orchestrator.cancelGoal(context(workspaceId), goalId, actor),
    board: (workspaceId: string, goalId: string) => goalBoard(store.scope(workspaceId), goalId),
    goals: (workspaceId: string, limit?: number) => listGoals(store.scope(workspaceId), limit),

    // ── approvals ──
    approvals: (workspaceId: string, status?: string) => store.scope(workspaceId).list("approvals", { status, order: "desc", limit: 200 }),
    async decide(workspaceId: string, approvalId: string, decision: "approve" | "decline", actor: string, note: string | null) {
      const r = await orchestrator.decideApproval(context(workspaceId), approvalId, decision, actor, note);
      if (r) track(r.continuation);
      return r;
    },

    // ── automation ──
    schedules: (workspaceId: string) => store.scope(workspaceId).list("schedules"),
    createSchedule: (workspaceId: string, input: automation.ScheduleInput, actor: string) => automation.createSchedule(store, store.scope(workspaceId), input, actor),
    editSchedule: (workspaceId: string, id: string, patch: Partial<automation.ScheduleInput>, actor: string) => automation.editSchedule(store, store.scope(workspaceId), id, patch, actor),
    pauseSchedule: (workspaceId: string, id: string, actor: string) => automation.setScheduleStatus(store, store.scope(workspaceId), id, "paused", actor),
    resumeSchedule: (workspaceId: string, id: string, actor: string) => automation.setScheduleStatus(store, store.scope(workspaceId), id, "active", actor),
    deleteSchedule: (workspaceId: string, id: string, actor: string) => automation.deleteSchedule(store.scope(workspaceId), id, actor),
    async runScheduleNow(workspaceId: string, id: string, actor: string) {
      const scoped = store.scope(workspaceId);
      const schedule = await scoped.get("schedules", id);
      if (!schedule) return null;
      return automation.fireSchedule(store, scoped, schedule, { actor, manual: true });
    },
    emit: (workspaceId: string, event: string, payload: Record<string, unknown>) => automation.emit(store, workspaceId, event, payload),
    tick: (now?: Date) => automation.automationTick(store, now),
    notifications: (workspaceId: string) => store.scope(workspaceId).list("notifications", { order: "desc", limit: 100 }),

    // ── trust & recovery ──
    audit: (workspaceId: string, filter: { goalId?: string; limit?: number } = {}) => store.scope(workspaceId).list("audit_log", { goalId: filter.goalId, order: "desc", limit: filter.limit ?? 200 }),
    checkpoints: (workspaceId: string) => store.scope(workspaceId).list("checkpoints", { order: "desc" }),
    checkpoint: (workspaceId: string, input: { scope?: string; label: string; actor: string }) => createCheckpoint(store, store.scope(workspaceId), { scope: input.scope ?? "workspace", label: input.label, by: input.actor, now: clock() }),
    rollback: (workspaceId: string, checkpointId: string, actor: string) => restoreCheckpoint(store, store.scope(workspaceId), checkpointId, actor, clock()),
  };
}

export type Harness = ReturnType<typeof createHarness>;

const g = globalThis as unknown as { __harness?: Harness };

/** The app's harness (default store, lib/llm). The marketing features register by default; test stubs only with MARKETING_HARNESS_STUBS=true. */
export function harness(): Harness {
  if (!g.__harness) {
    registerFeatures();
    if (harnessStubsEnabled()) registerHarnessStubs();
    g.__harness = createHarness();
  }
  return g.__harness;
}

export { registerTool, registerMcpServer, listTools, toMcpDescriptors, setToolSetting, effectiveTools } from "./tools";
export { registerAgentType, listAgentTypes, HarnessOff } from "./orchestrator";
export { registerSnapshotProvider, untrusted, audit } from "./trust";
export { registerNotifier, onEvent, startAutomation, automationStatus, ScheduleError } from "./automation";
export { setRetriever } from "./memory";
export { renderBoard } from "./runlog";
export { AUTONOMY_LEVELS, TASK_STATUSES, OUTBOUND_KINDS, MEMORY_KINDS } from "./types";
export type * from "./types";

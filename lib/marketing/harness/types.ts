import type { z } from "zod";

/**
 * MARKETING AGENTIC HARNESS — shared contracts. Pure types (plus a few
 * constants); no store, no model. Every module and every feature that
 * registers into the harness speaks these.
 *
 * The harness is COMPANY / OPERATOR level: everything belongs to a
 * WORKSPACE (one builder company's marketing). Every stored row carries
 * `workspaceId` and every store call is scoped by it (./store.ts).
 */

// ─── Workspace ──────────────────────────────────────────────────────────────

/**
 * How far the harness may act on its own. Outbound actions (send, publish,
 * ad spend, pricing, creative going live) are approval-gated at EVERY level.
 *  suggest-only                    plans and reads; every write is a suggestion for the operator; schedules only plan
 *  approve-each                    runs; every write (internal or outbound) waits for approval
 *  autonomous-within-guardrails    runs internal writes (drafts, memory, segments) itself; outbound still waits
 */
export const AUTONOMY_LEVELS = ["suggest-only", "approve-each", "autonomous-within-guardrails"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface Workspace {
  id: string;
  name: string;
  /** The harness on/off switch. Off: no goal intake, no runs, schedules skip. */
  enabled: boolean;
  autonomy: AutonomyLevel;
  /** Operator (rep) ids who may see and act in this workspace. Tenant boundary for the API. */
  members: string[];
  /** Optional link to the premium spine's builder. */
  builderId: string | null;
  /** Premium buildings this workspace ALSO receives (leads + content), beyond its builder's — each claimed by one workspace only. */
  projects?: string[];
  /** IANA zone for schedules. */
  timezone: string;
  /**
   * Automatic first replies to new leads (lib/marketing/agents/first-touch.ts):
   * low-risk types only, sent without approval. Off unless an operator turns it on.
   */
  autoFirstReply?: boolean;
  /** Demo record (npm run demo:seed) — removed with everything it owns by npm run demo:clear. */
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Goals, tasks, sub-agent runs (the run log) ─────────────────────────────

export type GoalStatus = "planning" | "planned" | "running" | "blocked" | "done" | "failed" | "cancelled";
export const TASK_STATUSES = ["todo", "doing", "done", "blocked", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Goal {
  id: string;
  workspaceId: string;
  text: string;
  status: GoalStatus;
  /** "operator:<repId>", "schedule:<id>", "event:<name>". */
  source: string;
  actor: string;
  /** Planner that produced the task breakdown. */
  planner: { kind: "llm" | "rules" | "none"; model?: string; note?: string } | null;
  /** True when untrusted content was part of the goal (e.g. a lead's message). */
  tainted: boolean;
  /** Execute after planning? false = plan-only (suggest-only schedules, or an operator's dry run). */
  execute: boolean;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  /** Registered sub-agent type that does it, or null when no registered capability fits (→ blocked). */
  agentType: string | null;
  /** What the planner asked for when no type fits — the missing capability, in words. */
  capability: string | null;
  input: Record<string, unknown>;
  /** Task ids that must be done first (the join graph). */
  dependsOn: string[];
  /** Set when a sub-agent spawned this task on demand. */
  parentTaskId: string | null;
  depth: number;
  status: TaskStatus;
  /** Why blocked / failed, or a one-line result when done. */
  note: string | null;
  output: unknown;
  createdAt: string;
  updatedAt: string;
}

export type StopReason =
  | "finished"
  | "awaiting_approval"
  | "blocked"
  | "max_steps"
  | "budget_tool_calls"
  | "budget_time"
  | "repeated_action"
  | "error_streak"
  | "harness_off"
  | "cancelled"
  | "spawned"
  | "error";

export interface RunStep {
  n: number;
  at: string;
  kind: "tool" | "finish" | "spawn" | "blocked" | "observation";
  /** What the policy said it was doing (never shown as a fact — it's the agent's own note). */
  thought?: string;
  tool?: string;
  args?: unknown;
  /** tool: executed | approval | denied | error. */
  outcome?: "executed" | "approval" | "denied" | "error";
  approvalId?: string;
  /** A short rendering of what came back (full results stay in the tool's own store). */
  observation?: string;
  ms?: number;
}

export interface SubagentRun {
  id: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  agentType: string;
  status: "running" | "waiting" | "done" | "failed" | "blocked";
  stopReason: StopReason | null;
  steps: RunStep[];
  /** Touched untrusted content → every write it proposes needs approval. */
  tainted: boolean;
  pendingApprovalId: string | null;
  output: unknown;
  toolCalls: number;
  /** Running wall-clock time used (ms), across resumes. */
  elapsedMs: number;
  startedAt: string;
  updatedAt: string;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

/** read = no side effects · internal = the workspace's own drafts / memory (reversible via checkpoints) · outbound = leaves the building. */
export type ToolEffect = "read" | "internal" | "outbound";
/** Outbound classes. All of them are approval-gated at every autonomy level, always. */
export const OUTBOUND_KINDS = ["send", "publish", "ad_spend", "pricing", "go_live"] as const;
export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

/** Something that ships to the public — checked for the RERA line and the AI label before it can go out. */
export interface ShipItem {
  /** The copy that goes out. */
  text: string;
  /** RERA registration number of the project it advertises; the copy must carry its "RERA Reg. No.:" line. */
  reraRegNo: string;
  /** The exact compliance line it must carry when it isn't the RERA line (e.g. a project's RERA exemption statement). */
  complianceLine?: string;
  /** The AI disclosure shown with it (e.g. "AI-generated"); required when AI wrote or rewrote it. */
  aiLabel: string | null;
  aiAssisted: boolean;
}

export interface ToolContext {
  workspaceId: string;
  /** The workspace's settings a tool may need (e.g. whether it is linked to the premium spine). */
  workspace: Pick<Workspace, "id" | "builderId" | "autonomy" | "projects">;
  goalId: string | null;
  taskId: string | null;
  runId: string | null;
  actor: string;
  now: string;
  /** Workspace-scoped company memory (./memory.ts). A tool can never reach another workspace's. */
  memory: import("./memory").WorkspaceMemory;
  /** Set when the call runs because an operator approved it — the idempotency key for anything it sends (exactly once). */
  approvalId?: string | null;
}

export interface HarnessTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  effect: ToolEffect;
  /** Required when effect = "outbound". */
  outbound?: OutboundKind;
  /** Always ask a human first. Forced true for every outbound tool at registration. */
  requiresApproval: boolean;
  /** Permission scopes a caller must hold, e.g. "memory:read", "campaigns:write", "outbound:send". */
  scopes: string[];
  /** One line for the approval card. */
  summarize?: (input: I) => string;
  /** Outbound send / publish / go_live: what ships (RERA + AI label checked). */
  ships?: (input: I) => ShipItem[];
  /** The result carries third-party content (lead messages, scraped pages) → taints the run that reads it. */
  untrustedOutput?: boolean;
  handler: (input: I, ctx: ToolContext) => Promise<O>;
  /** Set when the tool is an adapter over a remote MCP server's tool. */
  mcp?: { server: string; tool: string };
  /** The sub-agent type that owns it (documentation + the console; access is still each type's `tools` + `scopes`). */
  owner?: string;
}

/** Per-workspace tool settings (tool_registry). May disable a tool or TIGHTEN approval; never loosen it. */
export interface ToolSetting {
  id: string; // = tool name
  workspaceId: string;
  enabled: boolean;
  forceApproval: boolean;
  updatedAt: string;
}

// ─── Sub-agent types ────────────────────────────────────────────────────────

export interface Budget {
  maxSteps: number;
  maxToolCalls: number;
  maxMs: number;
  /** Consecutive failed tool calls before the run stops. */
  maxErrorStreak: number;
}

export interface GoalLimits {
  maxTasks: number;
  maxDepth: number;
  maxConcurrency: number;
}

/** A task as the planner (or a spawning sub-agent) proposes it. `dependsOn` are indexes into the same proposal. */
export interface TaskSpec {
  title: string;
  agentType: string | null;
  capability?: string | null;
  input?: Record<string, unknown>;
  dependsOn?: number[];
}

/** What a sub-agent's policy decides to do next. */
export type Decision =
  | { kind: "tool"; tool: string; args: unknown; thought?: string }
  | { kind: "finish"; output: unknown; summary: string }
  | { kind: "spawn"; tasks: TaskSpec[]; thought?: string }
  | { kind: "blocked"; reason: string };

export interface PolicyState {
  workspaceId: string;
  workspace: Pick<Workspace, "id" | "builderId" | "autonomy" | "projects">;
  goal: Pick<Goal, "id" | "text">;
  task: Pick<Task, "id" | "title" | "input">;
  steps: RunStep[];
  /** Tools this sub-agent may call (already filtered by its scopes and the workspace settings). */
  tools: Pick<HarnessTool, "name" | "description" | "effect" | "requiresApproval">[];
  memory: import("./memory").WorkspaceMemory;
}

export interface SubAgentType {
  type: string;
  description: string;
  /** Tool names it may call (each must also be within its scopes). */
  tools: string[];
  /** Permission scopes granted to runs of this type. */
  scopes: string[];
  /** Overrides of the default per-run budget. */
  budget?: Partial<Budget>;
  /** Deterministic decomposition: the tasks this type would take on for a goal (used when no model plans). */
  plan?: (goalText: string) => TaskSpec[] | null;
  /** The policy. Absent → the harness's model-driven policy over `tools` (runtime.ts). */
  decide?: (state: PolicyState) => Promise<Decision>;
  /** Instructions for the model-driven policy. */
  instructions?: string;
  /** Checks a finished output at join time. */
  verify?: (output: unknown) => { ok: boolean; problems: string[] };
  /** Ordering hint: this type's tasks wait for the (earlier) tasks of these types — e.g. distribution after content. Applied to model and no-model plans. */
  after?: string[];
}

// ─── Trust ──────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "declined" | "expired";

export interface Approval {
  id: string;
  workspaceId: string;
  goalId: string | null;
  taskId: string | null;
  runId: string | null;
  tool: string;
  args: unknown;
  effect: ToolEffect;
  outbound: OutboundKind | null;
  /** Why the gate stopped it: "outbound", "tool requires approval", "autonomy: approve-each", "untrusted input" … */
  reasons: string[];
  summary: string;
  /** suggestion = suggest-only mode; action = a gated action. */
  kind: "action" | "suggestion";
  /** What ships, and its compliance check (RERA, AI label). */
  ships: ShipItem[];
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  /** After approval: executed result (rendered) or the error. */
  result: { ok: boolean; observation: string } | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  at: string;
  /** e.g. goal.submitted, task.status, run.step, tool.executed, approval.requested, approval.approved, checkpoint.restored. */
  kind: string;
  actor: string;
  goalId: string | null;
  taskId: string | null;
  runId: string | null;
  detail: string;
  data: unknown;
}

export interface Checkpoint {
  id: string;
  workspaceId: string;
  /** "workspace" (everything) or "<provider>:<key>", e.g. "memory:campaign:diwali-2026". */
  scope: string;
  label: string;
  createdBy: string;
  createdAt: string;
  /** provider name → captured state. */
  snapshot: Record<string, unknown>;
}

// ─── Automation ─────────────────────────────────────────────────────────────

export interface Schedule {
  id: string;
  workspaceId: string;
  name: string;
  /** cron = time-based (5-field cron, workspace timezone); event = fires on emit(event). */
  trigger: { kind: "cron"; cron: string } | { kind: "event"; event: string };
  /** What a firing does: submit this goal (the payload of an event is attached, as untrusted). */
  goal: string;
  status: "active" | "paused";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastGoalId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  workspaceId: string;
  at: string;
  kind: "approval_needed" | "goal_finished" | "goal_blocked" | "schedule_fired" | "schedule_skipped" | "untrusted_flagged" | string;
  title: string;
  body: string;
  ref: string | null;
  read: boolean;
}

// ─── Memory ─────────────────────────────────────────────────────────────────

/** Company memory kinds. Built-in; features may store more kinds. */
export const MEMORY_KINDS = ["brand_kit", "project", "audience", "campaign", "decision", "learning"] as const;
/**
 * Never stored in company memory: leads, buildings, units and inventory live
 * ONLY in premium's shared stores (read through lib/marketing/agents/catalogue.ts).
 * Memory may hold pointers to them (a "project" item's propertyId, an enrolment's leadId).
 */
export const LOCAL_COPY_KINDS = ["lead", "leads", "unit", "units", "inventory", "building", "buildings", "property"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number] | (string & {});

export interface MemoryItem {
  id: string;
  workspaceId: string;
  kind: MemoryKind;
  /** Stable key within the kind (project id, campaign slug, lead id …). Upserts by (kind, key). */
  key: string;
  title: string;
  /** Structured content. */
  data: Record<string, unknown>;
  /** Searchable text (retrieval). */
  text: string;
  tags: string[];
  /** untrusted = third-party content (a lead's message) — always fenced when shown to a model. */
  trust: "trusted" | "untrusted";
  /** Where it came from: "operator:<id>", "tool:<name>", "import:premium" … */
  source: string;
  /** Demo record (npm run demo:seed) — removed by npm run demo:clear. */
  demo?: boolean;
  createdAt: string;
  updatedAt: string;
}

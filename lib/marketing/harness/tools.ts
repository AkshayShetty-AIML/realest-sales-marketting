import "server-only";
import { z } from "zod";
import type { ScopedStore } from "./store";
import { OUTBOUND_KINDS, type HarnessTool, type ToolContext, type ToolSetting } from "./types";

/**
 * 4 · TOOL & INTEGRATION LAYER — the ONLY way the harness acts. Empty by
 * design: features register their tools here.
 *
 * ── SEAM: how a feature adds a tool ──────────────────────────────────────
 *   registerTool({
 *     name: "draft_social_post", description: "…",
 *     inputSchema: z.object({ … }),
 *     effect: "internal",              // read | internal | outbound
 *     requiresApproval: false,         // forced true for outbound
 *     scopes: ["content:write"],
 *     handler: async (input, ctx) => …, // ctx.memory is this workspace's memory only
 *   });
 * Outbound tools also declare `outbound` (send | publish | ad_spend | pricing
 * | go_live) and, for anything that ships copy, `ships(input)` — the trust
 * layer checks the RERA line + AI label on it before the approval card is
 * created and again before it executes.
 *
 * Registration REFUSES an outbound tool without its kind, without approval,
 * or without its `outbound:<kind>` scope, so no feature can register a
 * self-publishing tool. Per workspace (tool_registry) an operator can disable
 * a tool or force approval on it — never loosen.
 *
 * MCP-READY: toMcpDescriptors() lists the registry in MCP tools/list shape,
 * and registerMcpServer() wraps a remote MCP server's tools as harness tools —
 * each remote tool must be DECLARED (effect, scopes); undeclared ones are
 * skipped, and anything declared outbound is approval-gated like the rest.
 */

const g = globalThis as unknown as { __harnessTools?: Map<string, HarnessTool> };
const registry = (): Map<string, HarnessTool> => (g.__harnessTools ??= new Map());

export class ToolRegistrationError extends Error {}

/** snake_case, optionally namespaced with one dot and camelCase verbs: "stub_note", "content.generate", "funnel.quizConfigure". */
const NAME = /^[a-z][a-z0-9_]{1,40}(\.[a-z][a-zA-Z0-9_]{1,40})?$/;

/** SEAM: a feature registers a tool. Throws on an unsafe definition. */
export function registerTool<I, O>(tool: HarnessTool<I, O>, options: { replace?: boolean } = {}): HarnessTool<I, O> {
  if (!NAME.test(tool.name)) throw new ToolRegistrationError(`tool name "${tool.name}" must be snake_case, optionally "<area>.<verb>"`);
  if (registry().has(tool.name) && !options.replace) throw new ToolRegistrationError(`tool "${tool.name}" is already registered`);
  const t = { ...tool } as HarnessTool<I, O>;
  if (t.effect === "outbound") {
    if (!t.outbound || !OUTBOUND_KINDS.includes(t.outbound)) throw new ToolRegistrationError(`outbound tool "${t.name}" must declare its kind (${OUTBOUND_KINDS.join(" | ")})`);
    if (!t.requiresApproval) throw new ToolRegistrationError(`outbound tool "${t.name}" must set requiresApproval: true — outbound is always operator-approved`);
    if (!t.scopes.includes(`outbound:${t.outbound}`)) throw new ToolRegistrationError(`outbound tool "${t.name}" must require the "outbound:${t.outbound}" scope`);
    if (["send", "publish", "go_live"].includes(t.outbound) && !t.ships) throw new ToolRegistrationError(`outbound tool "${t.name}" must declare ships() so RERA + AI label can be checked`);
  } else if (t.outbound) throw new ToolRegistrationError(`tool "${t.name}" declares an outbound kind but effect "${t.effect}"`);
  registry().set(t.name, t as unknown as HarnessTool);
  return t;
}

export function unregisterTool(name: string): void {
  registry().delete(name);
}

export const getTool = (name: string): HarnessTool | undefined => registry().get(name);
export const listTools = (): HarnessTool[] => Array.from(registry().values());

/** Validates proposed arguments against the tool's schema — whoever proposed them (a policy, a model, an operator). */
export function parseArgs(tool: HarnessTool, args: unknown): { ok: true; input: unknown } | { ok: false; error: string } {
  const r = tool.inputSchema.safeParse(args ?? {});
  return r.success ? { ok: true, input: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
}

// ─── per-workspace settings (tool_registry) ─────────────────────────────────

export interface EffectiveTool {
  tool: HarnessTool;
  enabled: boolean;
  /** The tool's own flag OR the workspace's forceApproval. */
  requiresApproval: boolean;
}

export async function effectiveTools(scoped: ScopedStore): Promise<EffectiveTool[]> {
  const settings = new Map((await scoped.list("tool_registry")).map((s) => [s.id, s]));
  return listTools().map((tool) => {
    const s = settings.get(tool.name);
    return { tool, enabled: s?.enabled ?? true, requiresApproval: tool.requiresApproval || Boolean(s?.forceApproval) };
  });
}

export async function effectiveTool(scoped: ScopedStore, name: string): Promise<EffectiveTool | null> {
  const tool = getTool(name);
  if (!tool) return null;
  const s = await scoped.get("tool_registry", name);
  return { tool, enabled: s?.enabled ?? true, requiresApproval: tool.requiresApproval || Boolean(s?.forceApproval) };
}

/** Disable / force approval for one tool in one workspace. Approval can be tightened, never loosened below the tool's own flag. */
export async function setToolSetting(scoped: ScopedStore, name: string, patch: { enabled?: boolean; forceApproval?: boolean }, now: string): Promise<ToolSetting> {
  if (!getTool(name)) throw new ToolRegistrationError(`no tool "${name}" is registered`);
  const current = await scoped.get("tool_registry", name);
  const next: ToolSetting = {
    id: name,
    workspaceId: scoped.workspaceId,
    enabled: patch.enabled ?? current?.enabled ?? true,
    forceApproval: patch.forceApproval ?? current?.forceApproval ?? false,
    updatedAt: now,
  };
  await scoped.put("tool_registry", next);
  return next;
}

// ─── execution ──────────────────────────────────────────────────────────────

const MAX_OBSERVATION = 1500;
/** A tool result as the agent sees it: compact JSON, capped. */
export function renderObservation(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  return text.length > MAX_OBSERVATION ? `${text.slice(0, MAX_OBSERVATION)}… [truncated]` : text;
}

export type InvokeResult = { ok: true; result: unknown; observation: string; ms: number } | { ok: false; error: string; ms: number };

/**
 * Runs a tool's handler. NOT a gate — callers reach it only through
 * trust.authorize() (runtime) or an approved request (trust.resolveApproval).
 */
export async function invoke(tool: HarnessTool, args: unknown, ctx: ToolContext, timeoutMs = 30_000): Promise<InvokeResult> {
  const started = Date.now();
  const parsed = parseArgs(tool, args);
  if (!parsed.ok) return { ok: false, error: `invalid arguments: ${parsed.error}`, ms: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      tool.handler(parsed.input, ctx),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs))),
    ]);
    return { ok: true, result, observation: renderObservation(result), ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "tool failed", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// ─── MCP ────────────────────────────────────────────────────────────────────

/** The registry in MCP `tools/list` shape (for exposing the harness's tools to an MCP host). */
export function toMcpDescriptors(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return listTools().map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown> }));
}

/** The minimum an MCP client must offer (the official SDK's Client satisfies it through a thin wrapper). */
export interface McpClientLike {
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

/** How the operator classifies one remote tool. null = do not register it. */
export type McpDeclaration = Pick<HarnessTool, "effect" | "outbound" | "scopes" | "ships" | "untrustedOutput"> & { requiresApproval?: boolean };

/**
 * Wraps a remote MCP server's tools as harness tools ("<server>__<tool>").
 * Arguments are passed through as an object (the remote server validates its
 * own schema); results are untrusted by default — they come from outside.
 */
export async function registerMcpServer(server: string, client: McpClientLike, declare: (remote: { name: string; description?: string }) => McpDeclaration | null): Promise<string[]> {
  const registered: string[] = [];
  for (const remote of await client.listTools()) {
    const d = declare(remote);
    if (!d) continue;
    const name = `${server}__${remote.name}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    registerTool(
      {
        name,
        description: remote.description ?? `${server} · ${remote.name}`,
        inputSchema: z.record(z.string(), z.unknown()),
        effect: d.effect,
        outbound: d.outbound,
        requiresApproval: d.effect === "outbound" ? true : Boolean(d.requiresApproval),
        scopes: d.scopes,
        ships: d.ships,
        untrustedOutput: d.untrustedOutput ?? true,
        mcp: { server, tool: remote.name },
        handler: (input) => client.callTool(remote.name, input),
      },
      { replace: true },
    );
    registered.push(name);
  }
  return registered;
}

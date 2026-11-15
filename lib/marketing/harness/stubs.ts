import "server-only";
import { z } from "zod";
import { registerAgentType, unregisterAgentType } from "./orchestrator";
import { registerTool, unregisterTool } from "./tools";
import type { Decision, PolicyState, SubAgentType } from "./types";

/**
 * TEST STUBS — NOT FEATURES. Generic tools and sub-agent types that exercise
 * the spine (decomposition, parallel sub-agents, the approval gate, outbound
 * compliance) before any marketing feature exists. No business logic: the
 * tools echo, note and pretend; the outbound stub never sends anything.
 *
 * Registered only by scripts/verify-harness.ts, or by the app when
 * MARKETING_HARNESS_STUBS=true (index.ts). Never in production.
 */

export const STUB_RERA = "STUB/RERA/0000";
export const STUB_TOOLS = ["stub_lookup", "stub_note", "stub_flagged", "stub_send"] as const;
export const STUB_TYPES = ["stub-researcher", "stub-drafter", "stub-outbound", "stub-splitter"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toolSteps = (s: PolicyState) => s.steps.filter((x) => x.kind === "tool");
const lastObservation = (s: PolicyState) => s.steps.at(-1)?.observation ?? "";

/** A policy that calls `tool` once with `args`, then finishes with what it saw. */
const once =
  (tool: string, args: (s: PolicyState) => unknown): ((s: PolicyState) => Promise<Decision>) =>
  async (s) => {
    const calls = toolSteps(s).filter((x) => x.tool === tool);
    if (calls.length === 0) return { kind: "tool", tool, args: args(s), thought: `call ${tool}` };
    return { kind: "finish", summary: `${tool} → ${calls.at(-1)!.outcome}${s.steps.at(-1)?.kind === "observation" ? `; ${lastObservation(s).slice(0, 120)}` : ""}`, output: { lastObservation: lastObservation(s) } };
  };

export function registerHarnessStubs(): void {
  const replace = { replace: true };
  registerTool(
    {
      name: "stub_lookup",
      description: "TEST STUB (read): searches this workspace's company memory.",
      inputSchema: z.object({ query: z.string().min(1), delayMs: z.number().int().min(0).max(2000).optional() }),
      effect: "read",
      requiresApproval: false,
      scopes: ["memory:read"],
      handler: async (input, ctx) => {
        if (input.delayMs) await sleep(input.delayMs);
        return { hits: (await ctx.memory.retrieve(input.query, { limit: 3 })).map((r) => r.item.title) };
      },
    },
    replace,
  );
  registerTool(
    {
      name: "stub_note",
      description: "TEST STUB (internal write): stores a draft note in company memory.",
      inputSchema: z.object({ key: z.string().min(1), text: z.string().min(1) }),
      effect: "internal",
      requiresApproval: false,
      scopes: ["drafts:write"],
      handler: async (input, ctx) => (await ctx.memory.upsert({ kind: "draft", key: input.key, title: input.text.slice(0, 80), text: input.text, source: `tool:stub_note` })).id,
    },
    replace,
  );
  registerTool(
    {
      name: "stub_flagged",
      description: "TEST STUB (internal, requiresApproval): an action that always asks first.",
      inputSchema: z.object({ what: z.string().min(1) }),
      effect: "internal",
      requiresApproval: true,
      scopes: ["drafts:write"],
      summarize: (i) => `Stub action: ${i.what}`,
      handler: async (input) => ({ did: input.what }),
    },
    replace,
  );
  registerTool(
    {
      name: "stub_send",
      description: "TEST STUB (outbound send): pretends to send a message. Sends nothing.",
      inputSchema: z.object({ text: z.string().min(1), reraRegNo: z.string().min(1), aiLabel: z.string().nullable() }),
      effect: "outbound",
      outbound: "send",
      requiresApproval: true,
      scopes: ["outbound:send"],
      summarize: (i) => `Send (stub): "${i.text.slice(0, 60)}"`,
      ships: (i) => [{ text: i.text, reraRegNo: i.reraRegNo, aiLabel: i.aiLabel, aiAssisted: true }],
      handler: async () => ({ sent: false, stub: true, note: "stub — nothing left the building" }),
    },
    replace,
  );

  const types: SubAgentType[] = [
    {
      type: "stub-researcher",
      description: "TEST STUB: looks things up in company memory (read-only).",
      tools: ["stub_lookup"],
      scopes: ["memory:read"],
      plan: (goal) => [{ title: `Research: ${goal.slice(0, 120)}`, agentType: "stub-researcher", input: { query: goal } }],
      decide: once("stub_lookup", (s) => ({ query: String(s.task.input.query ?? s.task.title), delayMs: Number(s.task.input.delayMs ?? 0) })),
    },
    {
      type: "stub-drafter",
      description: "TEST STUB: writes a draft note (internal write).",
      tools: ["stub_note", "stub_flagged"],
      scopes: ["memory:read", "drafts:write"],
      plan: (goal) => [{ title: `Draft: ${goal.slice(0, 120)}`, agentType: "stub-drafter", input: {} }],
      decide: async (s) => (s.task.input.flagged ? once("stub_flagged", () => ({ what: s.task.title }))(s) : once("stub_note", () => ({ key: s.task.id, text: `Draft for ${s.task.title}` }))(s)),
    },
    {
      type: "stub-outbound",
      description: "TEST STUB: proposes an outbound send (always approval-gated).",
      tools: ["stub_send"],
      scopes: ["outbound:send"],
      plan: (goal) => [{ title: `Send (stub): ${goal.slice(0, 120)}`, agentType: "stub-outbound", input: {} }],
      decide: once("stub_send", (s) => ({
        text: String(s.task.input.text ?? `Stub announcement.\nRERA Reg. No.: ${STUB_RERA}`),
        reraRegNo: String(s.task.input.reraRegNo ?? STUB_RERA),
        aiLabel: s.task.input.aiLabel === null ? null : String(s.task.input.aiLabel ?? "AI-generated"),
      })),
    },
    {
      type: "stub-splitter",
      description: "TEST STUB: splits its task into N parallel stub-researcher sub-tasks on demand.",
      tools: [],
      scopes: [],
      decide: async (s) => {
        const n = Number(s.task.input.n ?? 3);
        return { kind: "spawn", tasks: Array.from({ length: n }, (_, i) => ({ title: `Sub-research ${i + 1} of "${s.task.title}"`, agentType: "stub-researcher", input: { query: s.task.title, delayMs: Number(s.task.input.delayMs ?? 0) } })) };
      },
    },
  ];
  for (const t of types) registerAgentType(t, replace);
}

export function unregisterHarnessStubs(): void {
  for (const t of STUB_TOOLS) unregisterTool(t);
  for (const t of STUB_TYPES) unregisterAgentType(t);
}

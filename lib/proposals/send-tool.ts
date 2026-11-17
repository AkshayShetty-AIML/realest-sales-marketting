import "server-only";
import { z } from "zod";
import { audit, store } from "../store";
import { sendOutbound } from "../marketing/agents/tools";
import { onEvent } from "../marketing/harness/automation";
import type { HarnessTool, ShipItem } from "../marketing/harness/types";

/**
 * `proposal.send` — the approval-gated send of one proposal version
 * (lib/proposals/proposals.ts asks for the approval). Registered with the
 * marketing tools (lib/marketing/agents/index.ts); not in any sub-agent's
 * tool list, so no agent can plan it.
 */

export const proposalShips = (i: { body: string; complianceLine: string }): ShipItem[] => [{ text: `${i.body}\n\n${i.complianceLine}`, reraRegNo: i.complianceLine.startsWith("RERA Reg. No.: ") ? i.complianceLine.slice(15) : "", complianceLine: i.complianceLine, aiLabel: null, aiAssisted: false }];

export const proposalSend: HarnessTool<{ proposalId: string; leadId: string; version: number; contentHash: string; body: string; complianceLine: string }> = {
  name: "proposal.send",
  description: "Sends a buyer their proposal (all-in cost sheet + payment plans, PDF link) in-app. It carries prices, so it is outbound and ALWAYS needs an operator's approval. Not plannable by agents.",
  inputSchema: z.object({ proposalId: z.string().uuid(), leadId: z.string().min(1).max(160), version: z.number().int().min(1), contentHash: z.string().length(32), body: z.string().min(1).max(420), complianceLine: z.string().min(5).max(300) }),
  effect: "outbound",
  outbound: "send",
  requiresApproval: true,
  scopes: ["outbound:send"],
  summarize: (i) => `Send proposal v${i.version} to ${i.leadId} — it carries prices`,
  ships: proposalShips,
  handler: async (input, ctx) => {
    const p = await store().getProposal(input.proposalId);
    if (!p || p.leadId !== input.leadId || p.version !== input.version || p.contentHash !== input.contentHash || p.send.approvalId !== ctx.approvalId) throw new Error("What was approved doesn't match the saved proposal — nothing sent.");
    return sendOutbound(ctx, { tool: "proposal.send", channel: "in_app", payload: { title: `Proposal v${p.version}`, proposalId: p.id, leadId: p.leadId }, ships: proposalShips(input), leadId: p.leadId, template: input.body });
  },
};

/** approval.decided on proposal.send → the proposal's send status, and the lead's timeline. */
async function onDecided(_workspaceId: string, payload: Record<string, unknown>) {
  if (payload.tool !== proposalSend.name) return;
  const proposalId = (payload.args as { proposalId?: string } | undefined)?.proposalId;
  const p = proposalId ? await store().getProposal(proposalId) : null;
  if (!p || p.send.approvalId !== payload.approvalId) return;
  const executed = payload.executed as { ok: boolean; observation: string } | null;
  let sent = false;
  try {
    sent = Boolean(executed?.ok && (JSON.parse(executed.observation) as { sent?: boolean }).sent);
  } catch {
    /* not JSON */
  }
  const by = String(payload.actor).replace(/^operator:/, "");
  const status = payload.decision === "decline" ? "declined" : sent ? "sent" : "not_sent";
  const note = status === "declined" ? `declined by ${by}` : status === "sent" ? `approved by ${by}, delivered in-app` : `approved by ${by} but not sent: ${executed?.observation ?? "unknown"}`;
  await store().upsertProposal({ ...p, send: { ...p.send, status, at: new Date().toISOString(), note } });
  await audit(`proposal-${status.replace("_", "-")}`, p.leadId, by, `version ${p.version} — ${note}`);
}

export function registerProposalListeners(): void {
  onEvent("approval.decided", async (w, payload) => onDecided(w, payload), "sales:proposal-decided");
}



import "server-only";
import { registerAgentType } from "../harness/orchestrator";
import { registerTool } from "../harness/tools";
import { MARKETING_AGENT_TYPES } from "./subagents";
import { MARKETING_TOOLS } from "./tools";
import { registerNurtureListeners } from "./nurture-events";
import { registerFirstTouchListeners } from "./first-touch";
import { registerIntakeListeners } from "./lead-intake";
import { proposalSend, registerProposalListeners } from "../../proposals/send-tool";


/**
 * M1–M3 ON THE HARNESS — registers the marketing tools (each with its owning
 * sub-agent type) and the four sub-agent types through the documented seams.
 * Idempotent (re-registering replaces). Called by
 * lib/marketing/harness/features.ts when the app's harness starts.
 */
export function registerMarketingFeatures(): void {
  for (const { tool, owner } of MARKETING_TOOLS) registerTool({ ...tool, owner }, { replace: true });
  for (const agent of MARKETING_AGENT_TYPES) registerAgentType(agent, { replace: true });
  // Inbound lead → archetype nurture: enrol + first message as a pending approval.
  registerNurtureListeners();
  // New lead in the shared store → the funnel agent (tag, score, archetype, enrol, notify) + held first replies.
  registerIntakeListeners();
  registerFirstTouchListeners();
  // OPS-02: sending a proposal (it carries prices) — always approval-gated.
  registerTool({ ...proposalSend, owner: "distribution" } as never, { replace: true });
  registerProposalListeners();
}

export { MARKETING_AGENT_TYPES } from "./subagents";
export { MARKETING_TOOLS, OUTBOUND_MODE, adsSpendTool, KINDS } from "./tools";

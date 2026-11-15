import "server-only";
import { registerMarketingFeatures } from "../agents";

/**
 * THE FEATURE WIRING POINT — the only file in the harness that knows which
 * features exist. Each feature registers its tools and sub-agent types
 * through the seams (registerTool / registerAgentType); the seven spine
 * modules never import a feature.
 *
 *   M1–M3  lib/marketing/agents — content, funnel, distribution, analytics
 *   S1     the lead loop — new-lead intake (funnel), automated first touch
 */
export function registerFeatures(): void {
  registerMarketingFeatures();
}

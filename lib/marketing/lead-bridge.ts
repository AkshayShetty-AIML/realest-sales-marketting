import "server-only";
import type { Attribution } from "../premium/marketing-contract";
import { audit as salesAudit } from "../store";
import { harness, type Harness, type Workspace } from "./harness";
import { catalogue, sameBuilder } from "./agents/catalogue";

/**
 * THE INBOUND-LEAD BRIDGE — project pages capture leads straight into the
 * spine (premium POST /marketing/leads; the sales inbox reads the same row).
 * This raises `lead.captured` in that project's MARKETING WORKSPACE, so the
 * harness can enrol the lead (lib/marketing/agents/nurture-events.ts).
 *
 * Routing (one workspace per lead — tenants never share a lead):
 *  1. the workspace that took this BUILDING's leads (workspace.projects — set
 *     from the project page's "send this page's leads to…"; one workspace per building);
 *  2. else the workspace LINKED to the building's builder (one per builder).
 * No match → nothing is enrolled, the lead's sales timeline says why, and the
 * project page shows the gap with the control to connect it.
 * Never throws into the capture: a buyer's enquiry is saved whatever happens here.
 */

export async function workspaceForProject(propertyId: string, h: Harness = harness()): Promise<{ workspace: Workspace; via: "project" | "builder"; builder: string } | null> {
  const property = await catalogue()
    .getProperty(propertyId)
    .catch(() => null);
  if (!property) return null;
  const all = await h.store.listWorkspaces();
  // 1. a workspace that took this building's leads explicitly (the project page's connection) …
  const claimed = all.find((w) => (w.projects ?? []).includes(propertyId));
  if (claimed) return { workspace: claimed, via: "project", builder: property.builder };
  // 2. … else the workspace linked to the building's builder.
  const linked = all.filter((w) => sameBuilder(w.builderId, property.builder));
  return linked.length === 1 ? { workspace: linked[0], via: "builder", builder: property.builder } : null;
}

export async function bridgeLeadCaptured(lead: Attribution, h: Harness = harness()): Promise<{ routed: true; workspaceId: string; via: string } | { routed: false; reason: string }> {
  try {
    const target = await workspaceForProject(lead.propertyId, h);
    if (!target) {
      await salesAudit("marketing-nurture-unrouted", lead.leadId, "marketing-harness", `No marketing workspace receives ${lead.propertyName}'s leads — connect one on the project page (Marketing → Project pages) to send its archetype follow-ups.`);
      return { routed: false, reason: "no workspace for this project" };
    }
    await h.emit(target.workspace.id, "lead.captured", {
      leadId: lead.leadId,
      propertyId: lead.propertyId,
      propertyName: lead.propertyName,
      archetype: lead.archetype,
      archetypeReason: lead.archetypeReason,
      campaignId: lead.campaignId,
      source: lead.source,
      contactName: lead.contactName,
      magnet: lead.magnet,
    });
    return { routed: true, workspaceId: target.workspace.id, via: target.via };
  } catch (error) {
    console.warn(`[lead-bridge] ${lead.leadId}: ${error instanceof Error ? error.message : error}`);
    return { routed: false, reason: "bridge failed" };
  }
}

import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { premium } from "../premium/client";
import { marketing } from "../premium/marketing-client";
import type { Property, Unit } from "../premium/contract";
import { audit, store } from "../store";
import type { Proposal } from "../store/types";
import { complianceFor } from "../compliance";
import { greetingName } from "../grounding/compose";
import { mintLink } from "../links";
import { harness as appHarness, type Harness } from "../marketing/harness";
import { workspaceForProject } from "../marketing/lead-bridge";
import { brandKitFor } from "../marketing/agents/grounding";
import { sameBuilder } from "../marketing/agents/catalogue";
import { effectiveTool } from "../marketing/harness/tools";
import { audit as harnessAudit, requestApproval } from "../marketing/harness/trust";
import { notify } from "../marketing/harness/automation";
import type { ToolContext } from "../marketing/harness/types";
import { costSheet, type CostSheet } from "./cost-sheet";
import { proposalSend, proposalShips } from "./send-tool";

/**
 * OPS-02 · PROPOSALS. For a lead and a unit: the all-in cost sheet and the
 * payment plans (./cost-sheet.ts — premium's own rules), on the developer's
 * brand kit with the project's RERA line (or exemption), as a PDF and a
 * private share link. Saved against the lead; when the price, a charge or a
 * plan changes, generating again makes a NEW version — old versions are kept.
 *
 * Prices are read from premium at generation time (the unit's price, the
 * listing's cost sheet). Nothing here holds inventory.
 *
 * SENDING carries prices, so it ALWAYS goes through the approval gate:
 * `proposal.send` is an outbound tool (approval at every autonomy level) in
 * the marketing workspace that receives the project's leads; once approved
 * it is delivered in-app through the one send path. No workspace → it can't
 * be sent, and the rep is told why.
 */

export class ProposalError extends Error {
  override name = "ProposalError";
}

export interface ProposalContent {
  [key: string]: unknown;
  buyerFirstName: string | null;
  property: { id: string; name: string; builder: string; locality: string; city: string; possession: string };
  unit: { unitId: string; label: string; config: string | null; floor: number | null; facing: string | null; carpetSqft: number | null; priceAsOf: string };
  sheet: CostSheet;
  brand: { builderName: string; primaryColor: string; secondaryColor: string; source: "workspace" | "premium" | "default" };
  complianceLine: string;
  generatedAt: string;
}

const hashOf = (c: ProposalContent) => createHash("sha256").update(JSON.stringify({ unit: c.unit.unitId, sheet: c.sheet, line: c.complianceLine })).digest("hex").slice(0, 32);

async function brandFor(property: Property, h: Harness): Promise<ProposalContent["brand"]> {
  const target = await workspaceForProject(property.id, h).catch(() => null);
  if (target) {
    const w = target.workspace;
    const { kit } = await brandKitFor({ memory: h.memory(w.id), workspace: { id: w.id, builderId: w.builderId, autonomy: w.autonomy, projects: w.projects ?? [] } } as Pick<ToolContext, "memory" | "workspace">);
    if (kit) return { builderName: kit.builderName ?? property.builder, primaryColor: kit.primaryColor, secondaryColor: kit.secondaryColor, source: "workspace" };
  }
  // Premium's one kit only when it is this builder's — never another builder's (or a demo) brand on this project.
  const kit = await marketing.getBrandKit().catch(() => null);
  if (kit && sameBuilder(kit.builderName, property.builder)) return { builderName: kit.builderName ?? property.builder, primaryColor: kit.primaryColor, secondaryColor: kit.secondaryColor, source: "premium" };
  return { builderName: property.builder, primaryColor: "#0f6b46", secondaryColor: "#b7791f", source: "default" };
}

/** Builds the proposal for a lead and a unit; returns the latest version when nothing priced changed, else a new one. */
export async function generateProposal(leadId: string, unitId: string, actor: string, h: Harness = appHarness(), now = new Date()): Promise<{ proposal: Proposal; isNew: boolean }> {
  const lead = await premium.getLead(leadId);
  const property = await premium.getProperty(lead.propertyId);
  const unit = (await premium.listInventory({ projectId: property.id })).find((u) => u.unitId === unitId);
  if (!unit) throw new ProposalError("That unit isn't in this project's inventory.");
  const compliance = await complianceFor(property.id, property);
  if (!compliance) throw new ProposalError("This project has no RERA registration number or exemption — add one in Brand settings → Projects before making a proposal.");
  const sheet = costSheet(property, unit);
  if (sheet.onRequest) throw new ProposalError(sheet.reason);
  const content: ProposalContent = {
    buyerFirstName: greetingName(lead.contact.name),
    property: { id: property.id, name: property.name, builder: property.builder, locality: property.locality, city: property.city, possession: property.possession },
    unit: { unitId: unit.unitId, label: unit.label ?? unit.unitNo ?? unit.unitId, config: unit.config ?? null, floor: unit.floor ?? null, facing: unit.facing ?? null, carpetSqft: unit.carpetSqft ?? null, priceAsOf: unit.lastVerifiedAt },
    sheet,
    brand: await brandFor(property, h),
    complianceLine: compliance.line,
    generatedAt: now.toISOString(),
  };
  const contentHash = hashOf(content);
  const versions = (await store().listProposals({ leadId })).filter((p) => p.unitId === unitId);
  const latest = versions[0];
  if (latest && latest.contentHash === contentHash) return { proposal: latest, isNew: false };
  const proposal: Proposal = {
    id: randomUUID(),
    leadId,
    propertyId: property.id,
    unitId,
    version: (latest?.version ?? 0) + 1,
    contentHash,
    content,
    createdAt: now.toISOString(),
    createdBy: actor,
    send: { status: "draft", approvalId: null, workspaceId: null, at: null, note: null },
  };
  await store().upsertProposal(proposal);
  await audit("proposal-generated", leadId, actor, `${property.name} · ${content.unit.label} · version ${proposal.version} · all-in ₹${sheet.total.toLocaleString("en-IN")}${sheet.toConfirm.length ? ` (developer to confirm: ${sheet.toConfirm.join(", ")})` : ""}`);
  return { proposal, isNew: true };
}

/** Asks for approval to send one proposal version. Nothing is sent here. */
export async function requestProposalSend(proposalId: string, actor: string, h: Harness = appHarness(), now = new Date()): Promise<Proposal> {
  const p = await store().getProposal(proposalId);
  if (!p) throw new ProposalError("Proposal not found.");
  if (p.send.status === "awaiting_approval" || p.send.status === "sent") return p;
  const target = await workspaceForProject(p.propertyId, h).catch(() => null);
  if (!target) throw new ProposalError("No marketing workspace approves this project's messages — connect it under Marketing → Project pages, then send again.");
  const scoped = h.store.scope(target.workspace.id);
  const eff = await effectiveTool(scoped, proposalSend.name);
  if (!eff?.enabled) throw new ProposalError("Sending proposals is switched off in that workspace's tools.");
  const c = p.content as ProposalContent;
  const link = await mintLink("proposal", p.leadId, null, now, null, p.id);
  const body = `Hi${c.buyerFirstName ? ` ${c.buyerFirstName}` : ""}, here is your proposal for ${c.unit.label} at ${c.property.name}: the all-in cost and the payment plans. Figures marked "to confirm" are the developer's to confirm. ${link}`;
  const args = { proposalId: p.id, leadId: p.leadId, version: p.version, contentHash: p.contentHash, body, complianceLine: c.complianceLine };
  const approval = await requestApproval(scoped, { goalId: null, taskId: null, runId: null, tool: eff, args, reasons: ["it carries prices — a person approves every proposal", "outbound (send) — always approved by a human"], kind: "action", requestedBy: `rep:${actor}`, ships: proposalShips(args), now: now.toISOString() });
  const next: Proposal = { ...p, send: { status: "awaiting_approval", approvalId: approval.id, workspaceId: target.workspace.id, at: now.toISOString(), note: null } };
  await store().upsertProposal(next);
  await harnessAudit(scoped, { kind: "proposal.approval_requested", actor: `rep:${actor}`, detail: `proposal v${p.version} for ${p.leadId} (${c.unit.label}) — approval ${approval.id}`, data: { leadId: p.leadId, proposalId: p.id } });
  await notify(scoped, { kind: "approval_needed", title: "Proposal to approve", body: approval.summary, ref: approval.id });
  await audit("proposal-approval-requested", p.leadId, actor, `version ${p.version} waiting for approval in ${target.workspace.name}`);
  return next;
}

export const proposalsForLead = (leadId: string) => store().listProposals({ leadId });
export const unitLabel = (u: Pick<Unit, "label" | "unitNo" | "unitId">) => u.label ?? u.unitNo ?? u.unitId;

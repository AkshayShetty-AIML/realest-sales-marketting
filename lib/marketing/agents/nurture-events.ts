import "server-only";
import { ARCHETYPES, ARCHETYPE_LABEL, type Archetype } from "../../premium/marketing-contract";
import { audit as salesAudit } from "../../store";
import { notify, onEvent, registerTickHook } from "../harness/automation";
import { workspaceMemory } from "../harness/memory";
import type { HarnessStore } from "../harness/store";
import { effectiveTool } from "../harness/tools";
import { audit, complianceCheck, gate, requestApproval } from "../harness/trust";
import type { ToolContext } from "../harness/types";
import { reraLine } from "../facts";
import { brandKitFor } from "./grounding";
import { distributionAgent } from "./subagents";
import { humanSequences, sequenceStepText } from "./tools";

/**
 * INBOUND LEAD → ARCHETYPE NURTURE, FIRST MESSAGE → PENDING APPROVAL.
 *
 * Listens for `lead.captured` (raised by lib/marketing/lead-bridge.ts when a
 * project page captures a lead) inside the lead's project workspace:
 *
 *  1. (the lead stays in the premium leads store — referenced by id, never copied),
 *  2. ENROLS it in its archetype's nurture sequence — the tag the spine
 *     assigned, unchanged; the sequences are the same human-written ones the
 *     funnel agent and sequence.sendStep use (one source of truth),
 *  3. proposes step 1 through the SAME gate + compliance + tool as any agent:
 *     sequence.sendStep (outbound → always approval-gated, at every autonomy
 *     level; dry-run until a channel is connected), payload = the human-written
 *     first message + RERA line + its AI label ("Not AI-generated").
 *  4. No template for that archetype → a clearly LABELLED PLACEHOLDER approval
 *     flagged MISSING TEMPLATE (approving it can't send anything) — a gap is
 *     visible, never silent.
 *
 * `approval.decided` then marks step 1 done (dry-run, sent:false) or declined,
 * and writes it to the lead's sales timeline. Nothing here sends.
 */

export const ENROLMENT = "enrolment";
export const leadKey = (leadId: string) => `lead-${leadId}`;
export const MISSING_TEMPLATE = "MISSING TEMPLATE";

export interface LeadCaptured {
  leadId: string;
  propertyId: string;
  propertyName: string;
  archetype: Archetype | null;
  archetypeReason: string | null;
  campaignId: string | null;
  source: string | null;
  /** Masked by the spine ("Asha D."). */
  contactName: string | null;
  magnet: string | null;
}

/**
 * Step outcomes — every step ends visibly, none silently:
 *   scheduled → awaiting_approval → delivered (in_app, sent:true) | dry_run (external channel, sent:false)
 *                                 | declined | not_sent (approved but it could not go, with the reason)
 *   blocked (no template / no RERA / tool disabled — with the reason)
 */
export type StepStatus = "scheduled" | "awaiting_approval" | "delivered" | "dry_run" | "declined" | "not_sent" | "blocked";

export interface EnrolmentStep {
  index: number;
  channel: string;
  offsetHours: number;
  /** When it falls due (enrolment time + offset). It is proposed for approval then — never sent on its own. */
  dueAt: string;
  status: StepStatus;
  approvalId: string | null;
  note: string | null;
}

export interface EnrolmentData {
  leadId: string;
  archetype: Archetype;
  sequenceId: string | null;
  sequenceName: string | null;
  missingTemplate: boolean;
  /** The latest step approval (kept for older readers). */
  approvalId: string | null;
  steps: EnrolmentStep[];
  enrolledAt: string;
  contactName: string | null;
  propertyName: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function parseLead(p: Record<string, unknown>): LeadCaptured | null {
  const leadId = str(p.leadId);
  if (!leadId) return null;
  const a = str(p.archetype);
  return {
    leadId,
    propertyId: str(p.propertyId) ?? "",
    propertyName: str(p.propertyName) ?? "",
    archetype: a && (ARCHETYPES as readonly string[]).includes(a) ? (a as Archetype) : null,
    archetypeReason: str(p.archetypeReason),
    campaignId: str(p.campaignId),
    source: str(p.source),
    contactName: str(p.contactName),
    magnet: str(p.magnet),
  };
}

async function saveEnrolment(store: HarnessStore, workspaceId: string, e: EnrolmentData) {
  await workspaceMemory(store.scope(workspaceId)).upsert({
    kind: ENROLMENT,
    key: leadKey(e.leadId),
    title: `${e.sequenceName ?? `Nurture: ${ARCHETYPE_LABEL[e.archetype]} (missing template)`} — ${e.contactName ?? e.leadId}`,
    data: e as unknown as Record<string, unknown>,
    text: `${e.leadId} ${e.archetype}`,
    source: "event:lead.captured",
  });
}

/**
 * Proposes ONE step for approval through the same gate, compliance and tool
 * as any agent (sequence.sendStep). One approval per step, ever.
 */
async function proposeStep(store: HarnessStore, workspaceId: string, e: EnrolmentData, index: number, now: string): Promise<EnrolmentData> {
  const scoped = store.scope(workspaceId);
  const memory = workspaceMemory(scoped);
  const key = leadKey(e.leadId);
  const workspace = await store.getWorkspace(workspaceId);
  const step = e.steps[index];
  if (!workspace || !step || step.approvalId) return e;
  const block = async (note: string) => {
    e.steps[index] = { ...step, status: "blocked", note };
    await saveEnrolment(store, workspaceId, e);
    await audit(scoped, { kind: "nurture.blocked", actor: "harness:nurture", detail: `${key}: step ${index + 1} — ${note}`, data: { leadId: e.leadId } });
    await notify(scoped, { kind: "nurture_blocked", title: "Nurture step blocked", body: `${e.contactName ?? e.leadId}: step ${index + 1} — ${note}`, ref: key });
    return e;
  };
  const ctx = { workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] }, memory } as unknown as ToolContext;
  const sequence = (await humanSequences(ctx)).find((s) => s.params.archetype === e.archetype && s.active) ?? null;
  const template = sequence?.steps[index]?.template ?? null;
  const rera = (await brandKitFor(ctx)).kit?.defaultReraRegNo ?? null;
  if (!rera) return block("no RERA registration number in the brand kit — nothing can ship without it");
  const missing = !template;
  if (missing && index > 0) return block(`${MISSING_TEMPLATE}: the ${ARCHETYPE_LABEL[e.archetype]} sequence has no step ${index + 1} any more`);

  const text = template
    ? sequenceStepText(template, rera)
    : `[PLACEHOLDER — ${MISSING_TEMPLATE}] There is no human-written first message for ${ARCHETYPE_LABEL[e.archetype]} buyers. Write one (Sequences → "Nurture: ${ARCHETYPE_LABEL[e.archetype]}") — approving this placeholder sends nothing.\n\n${reraLine(rera)}`;
  const args = { archetype: e.archetype, stepIndex: index, text, reraRegNo: rera, leadKey: key };
  const eff = await effectiveTool(scoped, "sequence.sendStep");
  if (!eff) return block("sequence.sendStep is not registered");
  // Lead content is third-party: the run is tainted. Outbound → approval at every autonomy level regardless.
  const verdict = gate({ workspace, tool: eff, scopes: distributionAgent.scopes, tainted: true });
  if (verdict.kind === "deny") return block(verdict.reason);
  const ships = eff.tool.ships!(args as never);
  const compliance = complianceCheck(eff.tool.effect, eff.tool.outbound ?? null, ships);
  if (!compliance.ok) return block(compliance.problems.join("; "));
  const reasons = [
    ...(missing ? [`${MISSING_TEMPLATE}: no human-written first message exists for the ${ARCHETYPE_LABEL[e.archetype]} archetype — this is a labelled placeholder`] : []),
    `${index === 0 ? "first touch" : `step ${index + 1} of ${e.steps.length}`} (${step.channel === "in_app" ? "in-app — delivered on approval" : `${step.channel} — dry-run until connected`}) for ${ARCHETYPE_LABEL[e.archetype]} lead ${e.contactName ?? e.leadId}${e.propertyName ? ` · ${e.propertyName}` : ""}`,
    ...(verdict.kind === "approval" ? verdict.reasons : ["outbound (send) — always approved by a human"]),
  ];
  const approval = await requestApproval(scoped, { goalId: null, taskId: null, runId: null, tool: eff, args, reasons, kind: "action", requestedBy: "harness:nurture", ships, now });
  e.steps[index] = { ...step, status: "awaiting_approval", approvalId: approval.id, note: null };
  e.approvalId = approval.id;
  await saveEnrolment(store, workspaceId, e);
  await audit(scoped, { kind: "nurture.step.proposed", actor: "harness:nurture", detail: `${key}: step ${index + 1}/${e.steps.length} (${step.channel}) awaiting approval ${approval.id}`, data: { leadId: e.leadId, approvalId: approval.id, step: index } });
  await notify(scoped, { kind: "approval_needed", title: missing ? "New lead — missing nurture template" : index === 0 ? "New lead — first message to approve" : `Nurture step ${index + 1} to approve`, body: approval.summary, ref: approval.id });
  return e;
}

/** The next undecided step, if it is due and nothing is waiting on the operator. */
async function proposeNextIfDue(store: HarnessStore, workspaceId: string, e: EnrolmentData, now: Date): Promise<EnrolmentData> {
  if (e.steps.some((s) => s.status === "awaiting_approval")) return e;
  const next = e.steps.find((s) => s.status === "scheduled");
  if (!next || Date.parse(next.dueAt) > now.getTime()) return e;
  return proposeStep(store, workspaceId, e, next.index, now.toISOString());
}

/** Enrols one captured lead; idempotent per (workspace, lead). The lead stays in the premium leads store. */
export async function enrolCapturedLead(store: HarnessStore, workspaceId: string, lead: LeadCaptured, now = new Date()): Promise<{ status: "enrolled" | "placeholder" | "already" | "no_archetype" | "blocked"; approvalId: string | null; reason?: string }> {
  const scoped = store.scope(workspaceId);
  const memory = workspaceMemory(scoped);
  const key = leadKey(lead.leadId);
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return { status: "blocked", approvalId: null, reason: "workspace not found" };
  const existing = await memory.get(ENROLMENT, key);
  if (existing) return { status: "already", approvalId: str(existing.data.approvalId) };
  if (!lead.archetype) {
    await audit(scoped, { kind: "nurture.waiting", actor: "event:lead.captured", detail: `${key}: no archetype yet (quiz not taken) — enrols when it is tagged` });
    return { status: "no_archetype", approvalId: null };
  }
  const ctx = { workspace: { id: workspace.id, builderId: workspace.builderId, autonomy: workspace.autonomy, projects: workspace.projects ?? [] }, memory } as unknown as ToolContext;
  const sequence = (await humanSequences(ctx)).find((s) => s.params.archetype === lead.archetype && s.active) ?? null;
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
  let e: EnrolmentData = {
    leadId: lead.leadId,
    archetype: lead.archetype,
    sequenceId: sequence?.id ?? null,
    sequenceName: sequence?.name ?? null,
    missingTemplate: !sequence?.steps.length,
    approvalId: null,
    steps: sequence?.steps.length
      ? sequence.steps.map((st, i) => ({ index: i, channel: st.channel, offsetHours: st.offsetHours, dueAt: at(st.offsetHours), status: "scheduled", approvalId: null, note: null }))
      : [{ index: 0, channel: "in_app", offsetHours: 0, dueAt: at(0), status: "scheduled", approvalId: null, note: MISSING_TEMPLATE }],
    enrolledAt: now.toISOString(),
    contactName: lead.contactName,
    propertyName: lead.propertyName || null,
  };
  await saveEnrolment(store, workspaceId, e);
  e = await proposeStep(store, workspaceId, e, 0, now.toISOString());
  const first = e.steps[0];
  await audit(scoped, { kind: "nurture.enrolled", actor: "event:lead.captured", detail: `${key} → ${e.sequenceName ?? `${ARCHETYPE_LABEL[lead.archetype]} (MISSING TEMPLATE)`} · ${e.steps.length} step(s)`, data: { leadId: lead.leadId, archetype: lead.archetype } });
  await salesAudit("marketing-nurture-enrolled", lead.leadId, "marketing-harness", `${ARCHETYPE_LABEL[lead.archetype]} nurture (${e.steps.length} steps)${e.missingTemplate ? " — MISSING TEMPLATE, placeholder" : ""}: step 1 ${first.status === "awaiting_approval" ? "waiting for approval" : `blocked — ${first.note}`}`);
  return first.status === "awaiting_approval" ? { status: e.missingTemplate ? "placeholder" : "enrolled", approvalId: first.approvalId } : { status: "blocked", approvalId: null, reason: first.note ?? "blocked" };
}

/** approval.decided → that step's outcome (delivered / dry-run / declined / not sent), then the next step if it is due. */
async function onDecided(workspaceId: string, p: Record<string, unknown>, { store }: { store: HarnessStore }) {
  if (p.tool !== "sequence.sendStep") return;
  const key = str((p.args as Record<string, unknown> | undefined)?.leadKey);
  if (!key) return;
  const memory = workspaceMemory(store.scope(workspaceId));
  const item = await memory.get(ENROLMENT, key);
  if (!item) return;
  let e = item.data as unknown as EnrolmentData;
  const i = e.steps.findIndex((s) => s.approvalId === p.approvalId);
  if (i < 0) return;
  const executed = p.executed as { ok: boolean; observation: string } | null;
  let sent: { sent?: boolean; mode?: string; note?: string } = {};
  try {
    sent = executed?.ok ? (JSON.parse(executed.observation) as typeof sent) : {};
  } catch {
    /* not JSON */
  }
  const by = String(p.actor).replace(/^operator:/, "");
  const [status, note]: [StepStatus, string] =
    p.decision === "decline" ? ["declined", `declined by ${by}`]
    : !executed?.ok ? ["not_sent", `approved but not sent: ${executed?.observation ?? "unknown"}`]
    : sent.sent ? ["delivered", `delivered in-app (sent:true) — approved by ${by}`]
    : sent.mode === "dry_run" ? ["dry_run", `${e.steps[i].channel} not connected — dry-run recorded (sent:false), approved by ${by}`]
    : ["not_sent", sent.note ?? "not sent"];
  e.steps[i] = { ...e.steps[i], status, note };
  await saveEnrolment(store, workspaceId, e);
  await audit(store.scope(workspaceId), { kind: `nurture.step.${status}`, actor: String(p.actor), detail: `${key}: step ${i + 1} ${note}`, data: { leadId: e.leadId, approvalId: p.approvalId } });
  e = await proposeNextIfDue(store, workspaceId, e, new Date());
}

/** Engine tick: propose every enrolment's next step that has fallen due (across this store's workspaces). */
export async function proposeDueSteps(store: HarnessStore, now: Date): Promise<number> {
  let proposed = 0;
  for (const w of await store.listWorkspaces()) {
    for (const item of await store.scope(w.id).list("memory_items", { kind: ENROLMENT })) {
      const e = item.data as unknown as EnrolmentData;
      if (!Array.isArray(e.steps) || !e.steps.every((s) => "dueAt" in s)) continue;
      const before = e.steps.filter((s) => s.approvalId).length;
      const after = await proposeNextIfDue(store, w.id, e, now);
      proposed += after.steps.filter((s) => s.approvalId).length - before;
    }
  }
  return proposed;
}

/** Registered once by registerMarketingFeatures (keyed, so re-registration replaces). */
export function registerNurtureListeners(): void {
  onEvent("lead.captured", async (workspaceId, payload, { store }) => {
    const lead = parseLead(payload);
    if (lead) await enrolCapturedLead(store, workspaceId, lead);
  }, "marketing:nurture-enrol");
  onEvent("approval.decided", onDecided, "marketing:nurture-decided");
  registerTickHook("marketing:nurture-due-steps", async (store, now) => void (await proposeDueSteps(store, now)));
}

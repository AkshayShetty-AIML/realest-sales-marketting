import "server-only";
import { ARCHETYPES, ARCHETYPE_LABEL, type Archetype } from "../../premium/marketing-contract";
import { audit as salesAudit, store as salesStore } from "../../store";
import { autoAssign } from "../../automation/leads";
import { scoringModel } from "../../scoring/model";
import { notify, onEvent } from "../harness/automation";
import { workspaceMemory } from "../harness/memory";
import type { HarnessStore } from "../harness/store";
import { audit } from "../harness/trust";
import { catalogue, covers } from "./catalogue";
import { enrolCapturedLead, leadKey } from "./nurture-events";

/**
 * MKT-17 · NEW LEAD → THE FUNNEL AGENT. `lead.created` is raised in the
 * lead's workspace by the new-lead trigger (lib/automation/new-lead.ts) for
 * every new lead in the shared leads store. The funnel agent then, each step
 * in the audit log:
 *
 *   1. TAGS it (project, source, archetype, campaign),
 *   2. SCORES it (the desk's deterministic model — no model call),
 *   3. sets the ARCHETYPE when the spine knows it,
 *   4. ENROLS it in the matching human-written nurture sequence (step 1 as a
 *      pending approval — lib/marketing/agents/nurture-events.ts),
 *   5. ASSIGNS it if nobody has it yet, and NOTIFIES the assigned rep.
 *
 * Handled ONCE per lead (the intake record is the marker; a repeat event is
 * logged and ignored). The lead itself stays in premium — the intake record
 * holds its id and what the funnel derived (tags, score, archetype), never
 * the lead's contact or message. Every read goes through the shared source
 * (./catalogue.ts).
 */

export const INTAKE_KIND = "lead_intake";

export interface IntakeData {
  leadId: string;
  propertyId: string;
  tags: string[];
  score: number;
  band: string;
  archetype: Archetype | null;
  enrolment: string;
  repId: string | null;
  handledAt: string;
  trigger: string | null;
}

const asArchetype = (v: unknown): Archetype | null => (typeof v === "string" && (ARCHETYPES as readonly string[]).includes(v) ? (v as Archetype) : null);

export async function handleLeadCreated(store: HarnessStore, workspaceId: string, payload: Record<string, unknown>, now = new Date()): Promise<IntakeData | null> {
  const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
  if (!leadId) return null;
  const scoped = store.scope(workspaceId);
  const memory = workspaceMemory(scoped);
  const key = leadKey(leadId);
  const step = (kind: string, detail: string, data: Record<string, unknown> = {}) => audit(scoped, { kind, actor: "agent:funnel", detail: `${key}: ${detail}`, data: { leadId, ...data } });
  await audit(scoped, { kind: "event.lead.created", actor: "event:lead.created", detail: `${key} arrived in the shared leads store (${String(payload.trigger ?? "feed")})`, data: { leadId } });
  if (await memory.get(INTAKE_KIND, key)) {
    await step("lead.intake.duplicate", "already handled — nothing done again");
    return null;
  }
  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return null;
  const lead = await catalogue().getLead(leadId);
  const property = await catalogue().getProperty(lead.propertyId);
  if (!covers(workspace, property)) {
    await step("lead.intake.refused", `${property.name} isn't one of this workspace's buildings`);
    return null;
  }
  const attribution = await catalogue().attribution(leadId);

  // 1. tag
  const archetype = asArchetype(lead.archetype) ?? asArchetype(attribution?.archetype);
  const source = lead.source ?? attribution?.source ?? lead.kind;
  const tags = [`project:${property.id}`, `source:${source}`, `archetype:${archetype ?? "unknown"}`, ...(attribution?.campaignId ? [`campaign:${attribution.campaignId}`] : []), ...lead.tags.map((t) => `premium:${t}`)];
  await step("lead.tagged", tags.join(", "), { tags });

  // 2. score
  const [visits, checkIns, feedback, optIn] = await Promise.all([salesStore().listVisits({ leadId }), salesStore().listCheckIns({ leadId }), salesStore().listFeedback({ leadId }), salesStore().getOptIn(leadId)]);
  const s = scoringModel().score({ lead, property, visits, checkIns, feedback, optIn, now: now.getTime() });
  await step("lead.scored", `${s.score} (${s.band}) — ${s.top.map((r) => `${r.label} ${r.points > 0 ? "+" : ""}${r.points}`).join("; ")}`, { score: s.score, band: s.band, model: s.model });

  // 3. archetype
  await step("lead.archetype", archetype ? `${ARCHETYPE_LABEL[archetype]} (${lead.archetype ? "from the shared leads store" : "from the quiz attribution"})` : "not known yet — enrols once the quiz tags it");

  // 4. enrol
  let enrolment = "waiting for an archetype";
  if (archetype) {
    const r = await enrolCapturedLead(store, workspaceId, { leadId, propertyId: property.id, propertyName: property.name, archetype, archetypeReason: attribution?.archetypeReason ?? null, campaignId: attribution?.campaignId ?? null, source, contactName: lead.contact.name, magnet: attribution?.magnet ?? null }, now);
    enrolment = r.status === "blocked" ? `blocked — ${r.reason}` : r.status;
  }
  await step("lead.enrolled", enrolment);

  // 5. assign + notify the rep
  const repId = lead.assignedTo ?? (await autoAssign(leadId, lead.context.property?.locality ?? property.locality));
  const rep = repId ? (await salesStore().listReps()).find((r) => r.id === repId) ?? null : null;
  const who = rep?.name ?? repId;
  await notify(scoped, { kind: "new_lead", title: who ? `New lead for ${who}` : "New lead — no rep assigned", body: `${lead.contact.name ?? "A buyer"} · ${property.name} · ${s.band} (${s.score})${archetype ? ` · ${ARCHETYPE_LABEL[archetype]}` : ""}`, ref: key });
  await salesAudit("rep-notified", leadId, "agent:funnel", who ? `New lead for ${who}: ${s.band} (${s.score})${archetype ? `, ${ARCHETYPE_LABEL[archetype]}` : ""}` : "New lead — no active rep to assign it to");
  await step("lead.rep_notified", who ? `notified ${who}` : "no rep to notify (none active)", { repId });

  const data: IntakeData = { leadId, propertyId: property.id, tags, score: s.score, band: s.band, archetype, enrolment, repId, handledAt: now.toISOString(), trigger: typeof payload.trigger === "string" ? payload.trigger : null };
  await memory.upsert({ kind: INTAKE_KIND, key, title: `Intake — ${lead.contact.name ?? leadId}`, data: data as unknown as Record<string, unknown>, text: tags.join(" "), source: "agent:funnel" });
  return data;
}

export function registerIntakeListeners(): void {
  onEvent("lead.created", async (workspaceId, payload, { store }) => void (await handleLeadCreated(store, workspaceId, payload)), "marketing:funnel-intake");
}

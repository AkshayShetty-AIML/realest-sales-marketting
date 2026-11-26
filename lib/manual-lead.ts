import "server-only";
import { z } from "zod";
import { premium } from "./premium/client";
import { MANUAL_SOURCES, type Lead } from "./premium/contract";
import { audit } from "./store";
import { handleNewLead } from "./automation/new-lead";

/**
 * SAL-10 · A LEAD ENTERED BY HAND (walk-in, call, referral, event). Written
 * through premium's POST /leads — the shared leads store, nothing kept here.
 * Premium de-duplicates per project (same phone's last 10 digits, or the same
 * email): a duplicate comes back as the existing lead and nothing is written,
 * so the desk opens that lead instead. A new lead then goes through the SAME
 * new-lead handler as any other (first reply, tag, score, sequence, rep).
 */

export const MANUAL_SOURCE_LABEL: Record<(typeof MANUAL_SOURCES)[number], string> = { walk_in: "Walk-in", call: "Phone call", referral: "Referral", event: "Event", other: "Other" };

export const ManualLeadInput = z
  .object({
    name: z.string().trim().min(1, "Add the buyer's name.").max(120),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "That phone number doesn't look right.").optional().or(z.literal("").transform(() => undefined)),
    email: z.string().trim().email("That email doesn't look right.").max(254).optional().or(z.literal("").transform(() => undefined)),
    projectId: z.string().trim().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/, "Choose a project."),
    unitId: z.string().trim().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/).optional().or(z.literal("").transform(() => undefined)),
    source: z.enum(MANUAL_SOURCES),
    notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
    consent: z.literal(true, { message: "Confirm the buyer agreed to be contacted." }),
    channels: z.object({ in_app: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean() }),
  })
  .refine((v) => Boolean(v.phone || v.email), { message: "Add a phone number or an email.", path: ["phone"] })
  .refine((v) => !v.notes || v.notes.length >= 2, { message: "Notes need at least 2 characters.", path: ["notes"] });
export type ManualLeadInput = z.infer<typeof ManualLeadInput>;

export type ManualLeadResult = { duplicate: true; leadId: string } | { duplicate: false; leadId: string; firstReply: string };

export async function addManualLead(input: ManualLeadInput, repId: string, idempotencyKey: string, handle: (lead: Lead, trigger: string) => Promise<{ firstReply: string }> = (lead, trigger) => handleNewLead(lead, trigger)): Promise<ManualLeadResult> {
  const now = new Date().toISOString();
  const lead = await premium.createLead(
    {
      projectId: input.projectId,
      ...(input.unitId ? { unitId: input.unitId } : {}),
      contact: { name: input.name, ...(input.phone ? { phone: input.phone } : {}), ...(input.email ? { email: input.email } : {}) },
      source: input.source,
      ...(input.notes ? { notes: input.notes } : {}),
      consent: { given: true, at: now, text: `The buyer agreed to be contacted about this home — confirmed by ${repId} when entering the lead.`, channels: input.channels },
      createdBy: { service: "sales-app", user: repId },
    },
    idempotencyKey,
  );
  if (lead.duplicate) {
    await audit("manual-lead-duplicate", lead.id, repId, `${MANUAL_SOURCE_LABEL[input.source]} entry matched this existing lead (same phone or email on the project) — nothing new created`);
    return { duplicate: true, leadId: lead.id };
  }
  await audit("manual-lead-added", lead.id, repId, `${MANUAL_SOURCE_LABEL[input.source]} lead entered by hand${input.unitId ? ` · unit ${input.unitId}` : ""}`);
  const r = await handle(lead, `manual:${input.source}`);
  return { duplicate: false, leadId: lead.id, firstReply: r.firstReply };
}

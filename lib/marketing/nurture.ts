import "server-only";
import { marketing } from "../premium/marketing-client";
import { ARCHETYPES, ARCHETYPE_LABEL, type Archetype } from "../premium/marketing-contract";
import { audit, store } from "../store";
import { previewText } from "../sequence-preview";
import type { Sequence } from "../store/types";
import type { Attribution } from "../premium/marketing-contract";

/**
 * PERSONALISED NURTURE PER ARCHETYPE — the human-written sequences (stored
 * in the sales store so operators can edit them in Sequences) with trigger
 * "campaign_enrolled" and params.archetype. They are SENT only by the
 * marketing harness, one approval per step (lib/marketing/agents/nurture-events.ts);
 * the sales engine refuses to run them.
 *
 * Channels: in_app is delivered; email is SENT for real for these sequences
 * only (consent + provider permitting — lib/automation/delivery.ts); WhatsApp
 * is queued "pending Twilio". Every variable is filled from the spine record
 * (lib/automation/vars.ts) — a missing fact uses its fallback, never a guess.
 * Families: the record has no verified school or safety data, so the message
 * offers to have a colleague share it instead of naming anything.
 */

const seq = (archetype: Archetype, steps: Sequence["steps"]): Sequence => ({
  id: `seq-mkt-${archetype.replace(/_/g, "-")}`,
  // The engine sends as "sequence:<name>" — keep to the spine's actor alphabet (no dashes like —).
  name: `Nurture: ${ARCHETYPE_LABEL[archetype]}`,
  trigger: "campaign_enrolled",
  params: { archetype },
  active: true,
  stopOnReply: true,
  steps,
});

export const ARCHETYPE_SEQUENCES: Sequence[] = [
  seq("investor", [
    { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, thanks for looking at {{property}} as an investment. The platform's estimated rental yield is {{rentalYield|not available for this home yet}}. It is {{price|priced on request}} for {{carpetArea|the listed carpet area}}. See it for yourself: {{bookingLink}}" },
    { offsetHours: 0, channel: "email", template: "Hi {{firstName|there}},\n\n{{property}}, {{locality}} — the numbers an investor asks for first:\n• Price: {{price|on request}} for {{carpetArea|the listed carpet area}}\n• Estimated rental yield: {{rentalYield|not available yet}}\n• Status: {{possession|ask us}}\n\nBook a site visit: {{bookingLink}}\n\n— The sales team" },
    { offsetHours: 24, channel: "whatsapp", template: "Hi {{firstName|there}}, {{property}} ({{locality}}): {{price|price on request}}, est. rental yield {{rentalYield|on request}}. Book a visit: {{bookingLink}}" },
  ]),
  seq("end_user_family", [
    { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, {{property}} in {{locality}} could be a good fit for your family. It's {{community|a residential project}} with {{amenities|amenities we can walk you through}}. For schools and safety nearby, a colleague will share verified details — just ask here. Visit together: {{bookingLink}}" },
    { offsetHours: 0, channel: "email", template: "Hi {{firstName|there}},\n\nA few things families ask about {{property}}, {{locality}}:\n• Community: {{community|ask us}}\n• Amenities: {{amenities|ask us}}\n• Home: {{carpetArea|carpet area on request}}, {{possession|status on request}}\n\nFor schools and safety, reply and a colleague will send verified details for the area.\n\nBook a family visit: {{bookingLink}}" },
    { offsetHours: 48, channel: "whatsapp", template: "Hi {{firstName|there}}, would the family like to see {{property}} this weekend? Pick a slot: {{bookingLink}}" },
  ]),
  seq("nri", [
    { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, buying {{property}} from abroad? We can share documents online and arrange a video walkthrough, or a visit when you're in town. {{price|Price on request}} for {{carpetArea|the listed carpet area}}. Book a slot: {{bookingLink}}" },
    { offsetHours: 0, channel: "email", template: "Hi {{firstName|there}},\n\nFor NRI buyers looking at {{property}}, {{locality}}:\n• Price: {{price|on request}} for {{carpetArea|the listed carpet area}}\n• Status: {{possession|ask us}}\n• We can share documents online and arrange a video walkthrough.\n\nA colleague can explain the paperwork for buying from abroad — reply to this email.\n\nBook a time: {{bookingLink}}" },
    { offsetHours: 24, channel: "whatsapp", template: "Hi {{firstName|there}}, happy to do a video walkthrough of {{property}} at a time that suits your time zone. Pick a slot: {{bookingLink}}" },
  ]),
  seq("first_time", [
    { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, buying your first home is a big step — we'll keep it simple. {{property}}: {{price|price on request}} for {{carpetArea|the listed carpet area}}, {{possession|status on request}}. A colleague can walk you through home-loan eligibility. Book a visit: {{bookingLink}}" },
    { offsetHours: 0, channel: "email", template: "Hi {{firstName|there}},\n\nYour first home: here is {{property}}, {{locality}} in plain numbers.\n• Price: {{price|on request}} (for {{carpetArea|the listed carpet area}})\n• Status: {{possession|ask us}}\n\nNot sure what you can borrow? Reply and a colleague will go through home-loan eligibility with you.\n\nBook a visit: {{bookingLink}}" },
    { offsetHours: 48, channel: "whatsapp", template: "Hi {{firstName|there}}, any questions about {{property}} or home loans? We're happy to help. Book a visit: {{bookingLink}}" },
  ]),
  seq("upgrader", [
    { offsetHours: 0, channel: "in_app", template: "Hi {{firstName|there}}, moving up to more space? {{property}} in {{locality}} offers {{carpetArea|a larger layout}} with {{amenities|amenities we can show you}}. Come and see it: {{bookingLink}}" },
    { offsetHours: 0, channel: "email", template: "Hi {{firstName|there}},\n\nUpgrading? {{property}}, {{locality}}:\n• Space: {{carpetArea|on request}}\n• Price: {{price|on request}}\n• Amenities: {{amenities|ask us}}\n• Status: {{possession|ask us}}\n\nBook a visit: {{bookingLink}}" },
    { offsetHours: 48, channel: "whatsapp", template: "Hi {{firstName|there}}, ready to see the extra space at {{property}}? Pick a slot: {{bookingLink}}" },
  ]),
];

/** Puts the default archetype sequences in the store if they are missing (operator edits are kept). */
export async function ensureArchetypeSequences(): Promise<Sequence[]> {
  const existing = await store().listSequences();
  for (const s of ARCHETYPE_SEQUENCES) if (!existing.some((e) => e.id === s.id)) await store().upsertSequence({ ...s, updatedAt: new Date().toISOString() });
  return (await store().listSequences()).filter((s) => s.trigger === "campaign_enrolled");
}

/** Operator preview: every step RENDERED with example values ("Hi Meera, …") — never raw {{fields}}. */
export async function archetypePreviews() {
  const sequences = await ensureArchetypeSequences();
  return ARCHETYPES.map((archetype) => {
    const s = sequences.find((x) => x.params.archetype === archetype && x.active) ?? null;
    return {
      archetype,
      label: ARCHETYPE_LABEL[archetype],
      sequence: s ? { id: s.id, name: s.name } : null,
      steps: (s?.steps ?? []).map((step) => ({ offsetHours: step.offsetHours, channel: step.channel, text: previewText(step.template) })),
    };
  });
}

export class EnrolError extends Error {}

/**
 * Enrols ONE lead in a campaign: needs an archetype (the questionnaire) and an
 * active sequence for it; records the enrolment on the spine. It does NOT
 * start a sales-engine run — every nurture step is sent only through the
 * marketing harness's one approval-gated send path (the caller hands the lead
 * to it: lib/marketing/lead-bridge.ts → lead.captured → one approval per step).
 */
export async function enrolLead(campaignId: string, leadId: string, actor: string): Promise<{ sequence: Sequence; attribution: Attribution }> {
  const attribution = await marketing.getAttribution(leadId);
  if (!attribution.archetype) throw new EnrolError("Find this buyer's type first — answer the 5 quick questions.");
  const sequence = (await ensureArchetypeSequences()).find((s) => s.active && s.params.archetype === attribution.archetype);
  if (!sequence) throw new EnrolError(`There are no follow-up messages for ${ARCHETYPE_LABEL[attribution.archetype]} buyers yet.`);
  await marketing.enrol({ campaignId, leadId, sequenceId: sequence.id, enrolledBy: actor });
  await audit("marketing-enrolled", leadId, actor, `enrolled in campaign ${campaignId} → ${sequence.name} (each step waits for approval)`);
  return { sequence, attribution };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { completeJson } from "../llm";
import { premium } from "../premium/client";
import { audit, store } from "../store";
import type { Brochure, StepChannel } from "../store/types";
import type { LeadDetail, Property } from "../premium/contract";
import { buildFacts, type Fact } from "../grounding/facts";
import { guardReply } from "../grounding/guard";
import { mintBrochureLink } from "../links";
import { sendNow } from "../automation/delivery";
import { composeBrochure, type BrochureContent } from "./content";

/**
 * PERSONALISED BROCHURES — generate, store, send.
 *
 * AI-WRITTEN, GROUNDED: with an LLM configured, the model rewrites ONLY the
 * narrative paragraph, from the fact sheet + the fit table (the buyer's own
 * stated requirements vs this home). Its text must pass the same guard as
 * replies (every number in the facts, cites real fact keys, no links/contacts,
 * no promises) or it is discarded for the deterministic paragraph. The fit
 * table, key facts, grade and caveats are never AI-written.
 *
 * DELIVERY: in_app → a private link (/b/<token>) in the buyer's premium
 * thread; whatsapp / email → queued "pending Twilio (production)".
 */

const SYSTEM = `You write the opening paragraph of a personalised property brochure for one home buyer.
Rules — breaking any makes it unusable:
- Use ONLY the facts in FACTS and the rows in FIT (what the buyer asked for vs this home). Never state a number, date, price, amenity or claim that is not in FACTS.
- Where FIT says "differs", say so plainly; do not spin it.
- No links, phone numbers or emails. No discounts, guarantees, returns or "best price".
- Warm, specific, plain English. 2–4 sentences, under 480 characters. Address the buyer by first name if given.
Respond as JSON: {"intro": string, "factKeysUsed": string[]}.`;

const ModelOutput = z.object({ intro: z.string(), factKeysUsed: z.array(z.string()) });

async function aiIntro(content: BrochureContent, facts: Fact[]): Promise<{ intro: string; engine: "llm" | "template"; fallbackReason: string | null }> {
  const result = await completeJson({
    feature: "brochure-intro",
    schema: ModelOutput,
    system: SYSTEM,
    temperature: 0.2,
    maxTokens: 300,
    context: { FACTS: Object.fromEntries(facts.map((f) => [f.key, `${f.label}: ${f.value}`])) },
    prompt: {
      FIT: content.fit.map((r) => ({ requirement: r.label, buyer_said: r.stated, this_home: r.home, verdict: r.verdict })),
      BUYER_FIRST_NAME: content.buyerFirstName,
    },
  });
  if (!result.ok) return { intro: content.intro, engine: "template", fallbackReason: result.reason };
  // The fit table is part of what it may say: its values count as facts for the number check.
  const allowed = [...facts, ...content.fit.map((r, i) => ({ key: `fit_${i}`, label: r.label, value: `${r.stated} ${r.home}` }))];
  const verdict = guardReply(result.data.intro, result.data.factKeysUsed, allowed);
  if (!verdict.ok) return { intro: content.intro, engine: "template", fallbackReason: `guard: ${verdict.problems.join("; ")}` };
  return { intro: result.data.intro.trim(), engine: "llm", fallbackReason: null };
}

export class BrochureError extends Error {}

/** `source`: the lead and property when the caller already read them from the shared store (the marketing first-touch). */
export async function generateBrochure(leadId: string, actor: string, now = new Date(), source?: { lead: LeadDetail; property: Property }): Promise<Brochure> {
  const lead = source?.lead ?? (await premium.getLead(leadId));
  const property = source?.property ?? (await premium.getProperty(lead.propertyId));
  const facts = buildFacts(property);
  const content = composeBrochure(lead, property, now);
  const ai = await aiIntro(content, facts);
  const brochure: Brochure = {
    id: randomUUID(),
    leadId,
    propertyId: property.id,
    content: { ...content, intro: ai.intro },
    engine: ai.engine,
    fallbackReason: ai.fallbackReason,
    createdAt: now.toISOString(),
    createdBy: actor,
    deliveries: [],
  };
  await store().upsertBrochure(brochure);
  await audit("brochure-generated", leadId, actor, `${property.name} · ${ai.engine === "llm" ? "AI-written intro (passed the guard)" : `composed intro${ai.fallbackReason ? ` (${ai.fallbackReason})` : ""}`}`);
  return brochure;
}

/** Sends a brochure: in_app delivers a private link; other channels are queued pending Twilio. */
export async function sendBrochure(brochureId: string, channel: StepChannel, actor: string): Promise<Brochure> {
  const brochure = await store().getBrochure(brochureId);
  if (!brochure) throw new BrochureError("Brochure not found.");
  const link = await mintBrochureLink(brochure.leadId, brochure.id);
  const name = brochure.content.buyerFirstName;
  const body = `${name ? `Hi ${name}, here` : "Here"}'s a brochure we put together for you on ${brochure.content.property.name} — how it fits what you asked for, the key facts and the honest grade: ${link}`;
  const job = await sendNow(brochure.leadId, channel, body, `brochure:${actor}`);
  const updated: Brochure = {
    ...brochure,
    deliveries: [...brochure.deliveries, { channel, status: job.status as "sent" | "pending_twilio" | "failed", at: job.executedAt ?? job.createdAt, note: job.note, premiumMessageId: job.premiumMessageId }],
  };
  await store().upsertBrochure(updated);
  await audit("brochure-sent", brochure.leadId, actor, `${channel} · ${job.status === "pending_twilio" ? "queued (pending Twilio)" : job.status}`);
  return updated;
}

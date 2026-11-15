import "server-only";
import { z } from "zod";
import { completeJson } from "../llm";
import { composeReply, topicsOf, TOPIC_LABEL, type Draft } from "./compose";
import { guardReply } from "./guard";
import type { Fact } from "./facts";

/**
 * GROUNDED DRAFTING. With GROQ_API_KEY set, the model drafts the reply from
 * the fact sheet ONLY (Groq, through the one seam: lib/llm.ts); its draft must pass lib/grounding/guard.ts or it is
 * thrown away. Without a key — or on any model error or guard failure — the
 * deterministic composer answers. Either way the topics the facts can't cover
 * go to a human. SERVER ONLY (reads the LLM key).
 */

const ModelOutput = z.object({
  reply: z.string(),
  factKeysUsed: z.array(z.string()),
  needsHuman: z.boolean(),
});

export interface GroundedDraft extends Draft {
  engine: "llm" | "template";
  /** Why the LLM draft was not used, when it wasn't. */
  fallbackReason: string | null;
}

const SYSTEM = `You write the FIRST reply to a home buyer's inquiry for a real-estate builder's sales team.
Rules — breaking any of them makes the reply unusable:
- Use ONLY the facts in FACTS. Never state a number, date, price, amenity, or claim that is not in FACTS.
- If the buyer asks about something FACTS does not cover, do not guess: say a colleague will confirm that topic, and set needsHuman true.
- Never offer discounts, guarantees, or returns. Never include phone numbers, emails, or links.
- Warm, brief, plain English; at most 3 short sentences plus a sign-off "— <builder> sales team (automated reply)". Under 450 characters.
- Do not invent a visit time; say the team will confirm one.
Respond as JSON: {"reply": string, "factKeysUsed": string[] (keys from FACTS you relied on), "needsHuman": boolean}.`;

export async function draftGroundedReply(
  input: { kind: string; message: string; contactName: string | null },
  facts: Fact[],
): Promise<GroundedDraft> {
  const template = composeReply(input, facts);
  const result = await completeJson({
    feature: "grounded-reply",
    schema: ModelOutput,
    system: SYSTEM,
    temperature: 0.1,
    maxTokens: 400,
    context: { FACTS: Object.fromEntries(facts.map((f) => [f.key, `${f.label}: ${f.value}`])) },
    prompt: {
      INQUIRY_KIND: input.kind,
      BUYER_MESSAGE: input.message,
      BUYER_FIRST_NAME: input.contactName?.split(/\s+/)[0] ?? null,
    },
  });
  if (!result.ok) return { ...template, engine: "template", fallbackReason: result.reason };
  const out = result.data;
  const verdict = guardReply(out.reply, out.factKeysUsed, facts);
  if (!verdict.ok) return { ...template, engine: "template", fallbackReason: `guard: ${verdict.problems.join("; ")}` };
  // The model may answer more fluently, but which topics need a human is
  // decided deterministically — the model can't talk its way out of a handoff.
  const humanTopics = template.humanTopics;
  let body = out.reply.trim();
  if (humanTopics.length > 0 && !/colleague|team will|get back/i.test(body)) {
    body = `${body} A colleague will confirm ${humanTopics.map((t) => TOPIC_LABEL[t]).join(", ")} for you shortly.`;
    if (!guardReply(body, out.factKeysUsed, facts).ok) return { ...template, engine: "template", fallbackReason: "handoff note pushed the reply over the guard" };
  }
  return {
    body,
    factKeys: out.factKeysUsed,
    humanTopics,
    handoff: template.handoff || (out.needsHuman && topicsOf(input.kind, input.message).length === humanTopics.length),
    engine: "llm",
    fallbackReason: null,
  };
}

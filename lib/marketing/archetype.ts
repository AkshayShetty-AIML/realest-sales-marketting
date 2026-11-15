import type { Archetype, QuizAnswers } from "../premium/marketing-contract";

/**
 * BUYER ARCHETYPE — copied verbatim from the premium app
 * (lib/server/internal/archetype.ts → classify), like the QUIZ in
 * lib/premium/marketing-contract.ts. A deterministic, explainable
 * classification from the five quiz answers — no model. The SPINE remains
 * the one place that stores a lead's archetype; this lets the marketing
 * harness classify without a round trip (lead.archetype). Pure.
 *
 * Order matters — the first rule that matches wins:
 *   1. lives outside India                     → nri
 *   2. buying to rent out / as an investment   → investor
 *   3. first home purchase                     → first_time
 *   4. owns a smaller home and is moving up    → upgrader
 *   5. otherwise                               → end_user_family
 */
export function classify(a: QuizAnswers): { archetype: Archetype; reason: string } {
  if (a.residence === "abroad") return { archetype: "nri", reason: "lives outside India" };
  if (a.purpose === "invest") return { archetype: "investor", reason: "buying to rent out / invest" };
  if (a.firstHome === "yes") return { archetype: "first_time", reason: "first home purchase" };
  if (a.currentHome === "own_upgrade") return { archetype: "upgrader", reason: "moving up from a smaller owned home" };
  return { archetype: "end_user_family", reason: a.household === "family" ? "buying to live in, with family" : "buying to live in" };
}

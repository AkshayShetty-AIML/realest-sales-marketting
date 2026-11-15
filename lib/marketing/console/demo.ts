import "server-only";
import type { MemoryInput, WorkspaceMemory } from "../harness/memory";

/**
 * DEMO COMPANY — fictional MARKETING KNOWLEDGE for a builder "Trishul Infra":
 * brand kit (with an example RERA number), audiences tied to buyer
 * archetypes, decisions and learnings, plus a campaign plan for ONE REAL
 * premium building when one is given. Loaded only by `npm run demo:seed`
 * (scripts/demo.ts); every item is tagged demo: true so `npm run demo:clear`
 * removes exactly these.
 *
 * ONE SOURCE OF TRUTH: no buildings, units or leads are invented here — the
 * campaign references a building read live from the premium inventory.
 */

export const DEMO_RERA = "PRM/KA/RERA/1251/309/PR/171014/000123";
export const DEMO_MISSION = "Plan and send a launch campaign targeting NRI investors";

const items: MemoryInput[] = [
  {
    kind: "brand_kit",
    key: "main",
    title: "Trishul Infra — brand kit",
    data: { builderName: "Trishul Infra", toneOfVoice: "warm, plain, factual — no hype", defaultReraRegNo: DEMO_RERA, primaryColor: "#0f6b46", secondaryColor: "#b7791f", headingFont: "Playfair Display", bodyFont: "Inter" },
    text: "Trishul Infra brand: warm, plain, factual tone. Never superlatives, never price promises. Every ad carries the RERA registration number.",
    tags: ["brand"],
    source: "demo",
  },
  {
    kind: "audience",
    key: "nri-gulf",
    title: "NRI investors (Gulf)",
    data: { archetype: "nri", regions: ["Dubai", "Abu Dhabi", "Doha"], channels: ["email", "instagram"], notes: "Prefer video walkthroughs and online documentation; time-zone friendly slots." },
    text: "NRI investors living in Dubai, Abu Dhabi and Doha. Buying from abroad, value video walkthroughs and online paperwork.",
    tags: ["nri", "audience"],
    source: "demo",
  },
  {
    kind: "audience",
    key: "it-first-home",
    title: "First-time buyers (IT, North Bengaluru)",
    data: { archetype: "first_time", channels: ["instagram", "facebook"] },
    text: "Young IT professionals working around Manyata and Hebbal, buying their first home; care about loan eligibility and commute.",
    tags: ["first_time", "audience"],
    source: "demo",
  },
];

const campaign = (building: { id: string; name: string }): MemoryInput => ({
  kind: "campaign",
  key: "demo-launch",
  title: `${building.name} · Bookings (demo plan)`,
  data: { project: building.id, goal: "bookings", budgetInr: 500000, channels: ["instagram", "facebook", "email"], status: "planning", owner: "Marketing lead" },
  text: `Demo launch campaign plan for ${building.name}, aimed at bookings; Instagram, Facebook and email; budget ₹5 L (spend needs approval).`,
  tags: ["campaign", "launch"],
  source: "demo",
});

const decisions = [
  { title: "No discounts or price promises in ads", rationale: "Pricing is a human decision and RERA advertising rules; ads state only the price with its carpet area." },
  { title: "NRI outreach leads with video walkthroughs", rationale: "Gulf buyers can't visit easily; the walkthrough offer is in the human-written NRI nurture message." },
];
const learnings = [
  { title: "Weekday 10:00 IST posts reach Gulf buyers at 08:30 local", insight: "Morning IST slots suit NRI audiences in the Gulf.", evidence: "Engagement by hour, demo data" },
];

/** Loads the demo company into this workspace's memory, every item tagged demo (idempotent for kind+key items; decisions/learnings only once). */
export async function seedDemo(memory: WorkspaceMemory, building: { id: string; name: string } | null): Promise<{ items: number }> {
  const all = building ? [...items, campaign(building)] : items;
  for (const item of all) await memory.upsert({ ...item, demo: true });
  if ((await memory.list("decision")).length === 0) for (const d of decisions) await memory.upsert({ kind: "decision", key: `demo-${d.title}`, title: d.title, data: { rationale: d.rationale, by: "demo" }, text: `${d.title}\n${d.rationale}`, source: "demo", demo: true });
  if ((await memory.list("learning")).length === 0) for (const l of learnings) await memory.upsert({ kind: "learning", key: `demo-${l.title}`, title: l.title, data: { insight: l.insight, evidence: l.evidence }, text: `${l.title}\n${l.insight}\n${l.evidence}`, source: "demo", demo: true });
  return { items: all.length + decisions.length + learnings.length };
}

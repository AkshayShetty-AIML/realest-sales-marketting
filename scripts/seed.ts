/**
 * SALES-SIDE setup — idempotent, safe to re-run:  npm run db:seed
 *
 * SALES STATE ONLY — nothing about premium leads, and NO demo records (demo
 * reps, workspaces etc. come only from `npm run demo:seed`, tagged demo).
 * Leads, consent and conversations come from real activity; this seeds the
 * plan. Writes this app's store (own Supabase, or .data/sales-store.json):
 *
 *  - sequences   the default follow-up library (post-inquiry, no-reply, pre-visit,
 *                no-show recovery, cold-lead reactivation, post-visit interested,
 *                objection nudges) — added if missing, never overwriting edits
 *  - visit hours the self-booking defaults (if not set)
 *  - you         SEED_REP_EMAIL=<your Clerk email> adds you to the roster (rep-you),
 *                so you can sign in — only roster members get into the desk.
 *
 *  LEAD STATE (Batch 3) — sales-side state keyed to REAL premium lead ids,
 *  read live from GET /api/internal/leads (skipped if premium is unreachable,
 *  or with --no-leads). Nothing is fabricated: no fake consent, no fake visits.
 *  - routing     any UNASSIGNED open lead is routed to a rep (territory, then
 *                load) — PATCH /leads/:id {assignedTo}, the desk's normal job
 *  - sequences   up to 2 open inquiry-stage leads that have never had a run get
 *                the post-inquiry follow-up (real jobs: in_app steps deliver
 *                when due; the WhatsApp step queues "pending Twilio")
 */
import { store } from "../lib/store";
import { DEFAULT_SEQUENCES, startRun } from "../lib/automation/sequences";
import { DEFAULT_VISIT_SETTINGS } from "../lib/scheduling/slots";
import { premium } from "../lib/premium/client";
import { autoAssign } from "../lib/automation/leads";

async function main(): Promise<void> {
  const s = store();
  console.log(`Sales store: ${s.kind}`);

  const you = process.env.SEED_REP_EMAIL?.trim().toLowerCase();
  if (you) {
    const existing = (await s.listReps()).find((r) => r.id === "rep-you");
    await s.upsertRep({ id: "rep-you", name: "You (sales lead)", email: you, localities: [], active: true, clerkUserId: existing?.clerkUserId ?? null });
  }
  console.log(`✓ reps            ${you ? "you (SEED_REP_EMAIL)" : "none added (set SEED_REP_EMAIL to add yourself)"}`);
  // Defaults are added if missing — a sequence a rep has edited is never overwritten.
  const existing = new Set((await s.listSequences()).map((x) => x.id));
  let added = 0;
  for (const seq of DEFAULT_SEQUENCES) {
    if (existing.has(seq.id)) continue;
    await s.upsertSequence({ ...seq, updatedAt: new Date().toISOString() });
    added += 1;
  }
  await s.deleteSequence("seq-new-lead"); // Batch 1's non-runnable "planned" placeholder
  console.log(`✓ sequences       ${added} added (${DEFAULT_SEQUENCES.length} defaults; edited ones kept)`);
  if (!(await s.getVisitSettings())) await s.setVisitSettings(DEFAULT_VISIT_SETTINGS);
  console.log("✓ visit hours     10:00–18:00 IST, 60-min slots, 2 visitors per slot (if not already set)");

  if (process.argv.includes("--no-leads")) console.log("· lead state      skipped (--no-leads)");
  else await seedLeadState();

  console.log("\nSeeded. Re-running is safe.");
}

async function seedLeadState(): Promise<void> {
  const s = store();
  let leads;
  try {
    leads = (await premium.listLeads({ limit: 200 })).filter((l) => l.status !== "won" && l.status !== "lost");
  } catch (error) {
    console.log(`· lead state      skipped — premium unreachable (${error instanceof Error ? error.message : error})`);
    return;
  }
  let routed = 0;
  for (const lead of leads.filter((l) => !l.assignedTo)) {
    if (await autoAssign(lead.id, lead.context.property?.locality ?? null)) routed += 1;
  }
  console.log(`✓ routing         ${routed} unassigned lead${routed === 1 ? "" : "s"} routed (${leads.length} open premium leads)`);

  const seq = (await s.listSequences()).find((x) => x.id === "seq-post-inquiry" && x.active);
  const runs = await s.listRuns();
  const fresh = leads.filter((l) => l.stage === "inquiry" && !runs.some((r) => r.leadId === l.id));
  const started: string[] = [];
  if (seq && runs.filter((r) => r.sequenceId === seq.id).length < 2) {
    for (const lead of fresh.slice(0, 2)) {
      await startRun(seq, lead.id, { source: "seed" });
      started.push(lead.id);
    }
  }
  console.log(`✓ sequence runs   ${started.length ? `post-inquiry follow-up started for ${started.join(", ")}` : "none needed (already running, or no fresh inquiry-stage leads)"}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

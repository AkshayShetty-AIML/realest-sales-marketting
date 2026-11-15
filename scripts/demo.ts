/**
 * DEMO MODE ON DEMAND —  npm run demo:seed  ·  npm run demo:clear
 *
 * seed  loads a small demo set into THIS app's stores, every record tagged
 *       demo: true (a "Demo" badge in the UI):
 *        - reps       2 demo reps (never routed real leads — lib/automation/leads.ts)
 *        - harness    1 demo workspace (off, approve-each) for the operator, with the
 *                     demo company in its memory (lib/marketing/console/demo.ts) —
 *                     its campaign plan references a REAL premium building, read
 *                     live (skipped if premium is unreachable). No building is
 *                     invented, no builder/building is claimed, and NOTHING is
 *                     written to premium (no leads).
 * clear  removes only records tagged demo: true — demo reps, demo workspaces
 *        (with everything they own) and demo memory items in any workspace.
 */
import { store } from "../lib/store";
import type { Rep } from "../lib/store/types";
import { harness } from "../lib/marketing/harness";
import { seedDemo } from "../lib/marketing/console/demo";
import { premium } from "../lib/premium/client";

const DEMO_REPS: Rep[] = [
  { id: "demo-rep-arjun", name: "Arjun Mehta", email: "arjun.mehta@example.com", localities: ["Whitefield", "Sarjapur Road"], active: true, clerkUserId: null, demo: true },
  { id: "demo-rep-kavya", name: "Kavya Iyer", email: "kavya.iyer@example.com", localities: ["Electronic City", "Indiranagar"], active: true, clerkUserId: null, demo: true },
];
const DEMO_WORKSPACE = "Demo workspace";

async function seed(): Promise<void> {
  const s = store();
  for (const rep of DEMO_REPS) await s.upsertRep(rep);
  console.log(`✓ reps        ${DEMO_REPS.length} demo reps`);

  const operator = (await s.listReps()).find((r) => r.active && !r.demo)?.id ?? "demo-rep";
  const h = harness();
  const ws =
    (await h.store.listWorkspaces()).find((w) => w.demo && w.members.includes(operator)) ??
    (await h.createWorkspace({ name: DEMO_WORKSPACE, members: [operator], actor: "demo-seed", demo: true, autonomy: "approve-each" }));
  let building: { id: string; name: string } | null = null;
  try {
    building = (await premium.listBuildings())[0] ?? null;
  } catch (error) {
    console.log(`· building    skipped — premium unreachable (${error instanceof Error ? error.message : error})`);
  }
  const r = await seedDemo(h.memory(ws.id), building);
  console.log(`✓ workspace   "${ws.name}" (${ws.id}) for ${operator} · ${r.items} demo memory items${building ? ` · campaign plan for ${building.name}` : ""}`);
  console.log("\nDemo loaded. Remove it with: npm run demo:clear");
}

async function clear(): Promise<void> {
  const s = store();
  const reps = (await s.listReps()).filter((r) => r.demo);
  for (const rep of reps) await s.deleteRep(rep.id);
  console.log(`✓ reps        ${reps.length} demo reps removed`);

  const h = harness();
  const all = await h.store.listWorkspaces();
  const demoSpaces = all.filter((w) => w.demo);
  for (const w of demoSpaces) await h.store.deleteWorkspace(w.id);
  console.log(`✓ workspaces  ${demoSpaces.length} demo workspaces removed (with everything they own)`);
  let items = 0;
  for (const w of all.filter((x) => !x.demo)) {
    const scoped = h.store.scope(w.id);
    for (const item of (await scoped.list("memory_items")).filter((i) => i.demo)) {
      await scoped.remove("memory_items", item.id);
      items += 1;
    }
  }
  console.log(`✓ memory      ${items} demo items removed from other workspaces`);
  console.log("\nDemo cleared — only records tagged demo were touched.");
}

const command = process.argv[2];
void (command === "seed" ? seed() : command === "clear" ? clear() : Promise.reject(new Error("usage: tsx scripts/demo.ts seed|clear")))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });

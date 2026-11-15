/**
 * DEMO LEAD — npm run demo:lead -- --archetype nri [--page <slug>]
 *
 * Captures ONE fictional lead (example.com contact) on a real project page,
 * through exactly what the page's form does (app/b/lp/actions.ts): the
 * spine's capture (premium POST /marketing/leads — it classifies the
 * archetype from the quiz answers) and then the lead bridge into the
 * project's marketing workspace. Prints the routing and the pending
 * first-message approval it produced.
 *
 * Archetypes: investor · nri · first_time · upgrader · end_user_family
 * Needs: premium running, and a harness workspace linked to the spine
 * (Agent Harness → Settings → "Receive project-page leads").
 * Note: the running desk's lead feed will also send its usual instant reply.
 */
import { randomUUID } from "node:crypto";
import { marketing } from "../lib/premium/marketing-client";
import type { QuizAnswers } from "../lib/premium/marketing-contract";
import { CONSENT_TEXT, captureLead } from "../lib/marketing/capture";
import { bridgeLeadCaptured } from "../lib/marketing/lead-bridge";
import { harness } from "../lib/marketing/harness";

const ANSWERS: Record<string, QuizAnswers> = {
  nri: { purpose: "invest", residence: "abroad", firstHome: "no", household: "family", currentHome: "own_keep" },
  investor: { purpose: "invest", residence: "same_city", firstHome: "no", household: "other", currentHome: "own_keep" },
  first_time: { purpose: "live", residence: "same_city", firstHome: "yes", household: "single", currentHome: "rent" },
  upgrader: { purpose: "live", residence: "same_city", firstHome: "no", household: "family", currentHome: "own_upgrade" },
  end_user_family: { purpose: "live", residence: "other_city", firstHome: "no", household: "family", currentHome: "rent" },
};
const NAMES: Record<string, string> = { nri: "Asha Menon", investor: "Ravi Kumar", first_time: "Rahul Verma", upgrader: "Meera Shah", end_user_family: "Dev Patel" };

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const archetype = arg("archetype") ?? "nri";
  const answers = ANSWERS[archetype];
  if (!answers) throw new Error(`--archetype must be one of: ${Object.keys(ANSWERS).join(", ")}`);
  const pages = await marketing.listLandingPages({ limit: 100 });
  const page = arg("page") ? pages.find((p) => p.slug === arg("page")) : (pages.find((p) => p.status === "published") ?? pages[0]);
  if (!page) throw new Error("No project page found — create one under Marketing → Project pages.");
  const name = NAMES[archetype];
  console.log(`Project page /${page.slug} (${page.status}) · ${name} · quiz → expected ${archetype}`);

  const { lead } = await captureLead({
    page,
    magnet: "register_interest",
    contact: { name, email: `demo+${randomUUID().slice(0, 8)}@example.com` },
    consent: { in_app: true, email: true, whatsapp: false, sms: false, text: CONSENT_TEXT },
    source: page.status === "published" ? "landing_page" : "landing_page_preview",
    answers,
  });
  console.log(`  lead ${lead.leadId} · tagged ${lead.archetype} (${lead.archetypeReason}) · ${lead.propertyName}`);

  const routed = await bridgeLeadCaptured(lead);
  if (!routed.routed) {
    console.log(`  NOT routed: ${routed.reason}. Link a workspace: Agent Harness → Settings → "Receive project-page leads".`);
    process.exit(1);
  }
  const ws = await harness().getWorkspace(routed.workspaceId);
  console.log(`  → workspace "${ws?.name}" (${routed.via})`);
  const approval = (await harness().approvals(routed.workspaceId, "pending")).find((a) => (a.args as { leadKey?: string }).leadKey === `lead-${lead.leadId}`);
  if (!approval) {
    console.log("  no approval created — see the workspace's Audit tab (nurture.*) for why.");
    process.exit(1);
  }
  console.log(`  PENDING APPROVAL ${approval.id}\n  ${approval.summary}\n  reasons: ${approval.reasons.join(" | ")}\n  label: ${approval.ships[0]?.aiLabel}\n  ---\n${approval.ships[0]?.text.split("\n").map((l) => `  ${l}`).join("\n")}\n  ---`);
  console.log(`  Harness: http://localhost:3001/marketing/harness/approvals?ws=${routed.workspaceId}\n  Sales lead: http://localhost:3001/leads/${lead.leadId}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

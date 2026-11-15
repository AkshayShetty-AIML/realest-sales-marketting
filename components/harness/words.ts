/**
 * Plain words for harness values — shared by server and client components.
 * Pure. (The harness stores enums; the console shows words.)
 */
export const AUTONOMY: { value: string; label: string; help: string }[] = [
  { value: "suggest-only", label: "Suggest only", help: "Plans and reads; every write becomes a suggestion for you. Schedules only plan." },
  { value: "approve-each", label: "Approve each", help: "Runs, but every write — internal or outbound — waits for your approval." },
  { value: "autonomous-within-guardrails", label: "Autonomous", help: "Drafts and plans on its own. Anything outbound still waits for you." },
];
export const autonomyWord = (a: string) => AUTONOMY.find((x) => x.value === a)?.label ?? a;

/** "content" → "Content agent". */
export const agentWord = (type: string | null) => (type ? `${type.charAt(0).toUpperCase()}${type.slice(1).replace(/-/g, " ")} agent` : "Unassigned");

export const OUTBOUND_WORD: Record<string, string> = { send: "send", publish: "publish", ad_spend: "ad spend", pricing: "pricing", go_live: "go live" };

/** Audit kinds, grouped for the timeline's icons / colours. */
export function auditTone(kind: string): "approval" | "tool" | "goal" | "checkpoint" | "schedule" | "settings" | "risk" | "step" {
  if (kind.startsWith("approval.")) return "approval";
  if (kind === "tool.executed" || kind === "tool.failed") return "tool";
  if (kind.startsWith("checkpoint.")) return "checkpoint";
  if (kind.startsWith("schedule.")) return "schedule";
  if (kind.startsWith("workspace.") || kind === "tool.setting") return "settings";
  if (kind === "untrusted.flagged" || kind === "goal.failed") return "risk";
  if (kind === "run.step" || kind === "task.status" || kind === "subagent.spawned" || kind === "run.stopped") return "step";
  return "goal";
}

/** What came back from an approved action, in words — the dry-run is stated, never hidden. */
export function executedWords(executed: { ok: boolean; observation: string } | null | undefined): { ok: boolean; text: string } {
  if (!executed) return { ok: true, text: "Declined — nothing was run." };
  if (!executed.ok) return { ok: false, text: `Approved, but it did not run: ${executed.observation}` };
  try {
    const r = JSON.parse(executed.observation) as { sent?: boolean; mode?: string; channel?: string; note?: string };
    if (r.sent === true) return { ok: true, text: `Approved — delivered ${r.channel === "in_app" ? "in-app" : `on ${r.channel}`} (sent:true): in the lead's conversation and the buyer's inbox.` };
    if (r.mode === "no_recipient") return { ok: false, text: `Approved, but not sent: ${r.note ?? "no recipient"}` };
    if (r.sent === false) return { ok: true, text: `Approved — ${r.channel ?? "this channel"} isn't connected, so it ran as a dry-run: sent:false. Recorded, not sent.` };
  } catch {
    /* not JSON */
  }
  return { ok: true, text: "Approved — it ran." };
}

import Link from "next/link";
import type { Approval, Workspace } from "@/lib/marketing/console/read";
import { ago } from "@/lib/time";
import { ApprovalActions } from "./Controls";
import { Marker, ShipPreview, StatusPill } from "./Parts";
import { agentWord, executedWords } from "./words";

/**
 * One gated action: what it would do, why the gate stopped it, exactly what
 * would ship (copy + RERA line + AI label), and the decision — through the
 * existing approvals endpoint, which re-checks everything before it runs.
 */
export function ApprovalCard({ approval: a, workspace, goalText, showMission = true }: { approval: Approval; workspace: Workspace; goalText?: string | null; showMission?: boolean }) {
  const result = a.status === "approved" ? executedWords(a.result) : null;
  const leadKey = (a.args as { leadKey?: unknown } | null)?.leadKey;
  const leadId = typeof leadKey === "string" && leadKey.startsWith("lead-") ? leadKey.slice(5) : null;
  return (
    <article id={a.id} className={`card scroll-mt-24 p-5 ${a.status === "pending" ? "border-ochre/50" : ""}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={a.status} />
            <Marker tone={a.kind === "suggestion" ? "neutral" : "approval"}>{a.kind === "suggestion" ? "Suggestion" : "Approval Required"}</Marker>
            {a.reasons.some((r) => r.startsWith("MISSING TEMPLATE")) && <Marker tone="tainted">Missing template · placeholder</Marker>}
            <span className="font-mono text-[11px] text-muted">{a.tool}</span>
          </div>
          <h3 className="mt-2 text-[15px] font-semibold leading-snug text-ink">{a.summary}</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            {agentWord(a.requestedBy.replace(/^agent:/, ""))} · {workspace.name} · {ago(a.createdAt)}
            {leadId && <> · <Link className="text-brand hover:underline" href={`/leads/${encodeURIComponent(leadId)}`}>open the lead in sales</Link></>}
            {showMission && a.goalId && (
              <> · <Link className="text-brand hover:underline" href={`/marketing/harness/missions/${encodeURIComponent(workspace.id)}/${encodeURIComponent(a.goalId)}${a.taskId ? `?task=${encodeURIComponent(a.taskId)}` : ""}`}>{goalText ? `“${goalText.slice(0, 60)}${goalText.length > 60 ? "…" : ""}”` : "mission"}</Link></>
            )}
          </p>
        </div>
      </header>
      <div className="mt-3"><ShipPreview approval={a} /></div>
      <footer className="mt-4 border-t border-line pt-3">
        {a.status === "pending" ? (
          <ApprovalActions workspaceId={workspace.id} approvalId={a.id} />
        ) : (
          <p className={`text-[13px] ${a.status === "declined" || (result && !result.ok) ? "text-trust-risk" : a.status === "approved" ? "text-trust-good" : "text-muted"}`}>
            {a.status === "approved" ? result!.text : a.status === "declined" ? "Declined — nothing was run." : `Expired${a.note ? ` (${a.note})` : ""}.`}
            {a.decidedBy && <span className="text-muted"> · {a.decidedBy.replace(/^operator:/, "")} {a.decidedAt ? ago(a.decidedAt) : ""}{a.note && a.status !== "expired" ? ` · “${a.note}”` : ""}</span>}
          </p>
        )}
      </footer>
    </article>
  );
}

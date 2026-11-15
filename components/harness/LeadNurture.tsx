import Link from "next/link";
import { nurtureForLead } from "@/lib/marketing/console/read";
import { Card } from "@/components/ui/Card";
import { ago } from "@/lib/time";
import { ApprovalActions } from "./Controls";
import { Marker, ShipPreview, StatusPill } from "./Parts";
import { executedWords } from "./words";

const STEP: Record<string, { label: string; status: string }> = {
  scheduled: { label: "Scheduled", status: "todo" },
  awaiting_approval: { label: "Waiting for approval", status: "pending" },
  delivered: { label: "Delivered · sent:true", status: "done" },
  dry_run: { label: "Dry-run · sent:false", status: "paused" },
  declined: { label: "Declined", status: "declined" },
  not_sent: { label: "Not sent", status: "failed" },
  blocked: { label: "Blocked", status: "blocked" },
  // Older enrolments
  done: { label: "Done", status: "done" },
  later: { label: "Later", status: "todo" },
};

const dueWords = (iso: string) => {
  const h = Math.round((Date.parse(iso) - Date.now()) / 3_600_000);
  return h > 0 ? `due in ${h} h` : "due now";
};

/**
 * MARKETING NURTURE on the sales lead page: the archetype sequence the lead
 * was enrolled in by the marketing harness, step by step, and the pending
 * first message with Approve / Decline — the same harness approval (same
 * endpoint, same gate), not a copy. Only the operator's own workspaces.
 */
export async function LeadNurture({ operatorId, leadId }: { operatorId: string; leadId: string }) {
  const rows = await nurtureForLead(operatorId, leadId).catch(() => []);
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ workspace, enrolment, approvals }) => {
        const e = enrolment?.data as { archetype?: string; sequenceName?: string | null; missingTemplate?: boolean; steps?: { index: number; channel: string; offsetHours: number; status: string; note: string | null; dueAt?: string }[] } | undefined;
        // One approval record per step — the same record the harness queue shows; deciding here resolves it there too.
        const pending = approvals.find((a) => a.status === "pending");
        const decided = approvals.filter((a) => a.status !== "pending");
        const stepOf = (a: { args: unknown }) => ((a.args as { stepIndex?: number } | null)?.stepIndex ?? 0) + 1;
        return (
          <Card key={workspace.id} title="Marketing nurture" action={pending ? <Marker tone="approval">Approval Required</Marker> : e?.missingTemplate ? <Marker tone="tainted">Missing template</Marker> : undefined} bodyClassName="px-5 py-3">
            <p className="text-[12px] text-muted">
              {e?.sequenceName ?? "No sequence"}{e?.archetype ? ` · tagged ${e.archetype.replace(/_/g, " ")}` : ""} · <Link className="text-brand hover:underline" href={`/marketing/harness/approvals?ws=${encodeURIComponent(workspace.id)}`}>{workspace.name}</Link>
            </p>
            {e?.steps && (
              <ol className="mt-2 space-y-1">
                {e.steps.map((s) => (
                  <li key={s.index} className="flex items-center gap-2 text-[12px]">
                    <span className="w-14 shrink-0 font-medium text-ink">Step {s.index + 1}</span>
                    <span className="w-16 shrink-0 text-body">{s.channel.replace("_", "-")}</span>
                    <StatusPill status={STEP[s.status]?.status ?? "idle"} label={STEP[s.status]?.label ?? s.status} />
                    {s.status === "scheduled" && s.dueAt && <span className="text-muted">{dueWords(s.dueAt)}</span>}
                    {s.note && s.status !== "scheduled" && s.status !== "awaiting_approval" && <span className="truncate text-muted" title={s.note}>{s.note}</span>}
                  </li>
                ))}
              </ol>
            )}
            {pending && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <p className="text-[13px] font-semibold text-ink">Step {stepOf(pending)} — waiting for approval <span className="font-normal text-muted">· {ago(pending.createdAt)}</span></p>
                <ShipPreview approval={pending} />
                <ApprovalActions workspaceId={workspace.id} approvalId={pending.id} compact />
              </div>
            )}
            {decided.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-2">
                {decided.map((a) => (
                  <li key={a.id} className={`text-[12px] ${a.status === "approved" && a.result?.ok ? "text-trust-good" : "text-muted"}`}>
                    Step {stepOf(a)}: {a.status === "approved" ? executedWords(a.result).text : a.status === "declined" ? "Declined — nothing was sent." : "Expired."} {a.decidedAt ? ago(a.decidedAt) : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </>
  );
}

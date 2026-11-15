import Link from "next/link";
import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { approvalsFor, myWorkspace, myWorkspaces } from "@/lib/marketing/console/read";
import { PageHeader } from "@/app/_shell/AppShell";
import { ApprovalCard } from "@/components/harness/ApprovalCard";
import { WorkspacePicker } from "@/components/harness/Nav";
import { DryRunBanner, Empty } from "@/components/harness/Parts";

export const dynamic = "force-dynamic";

/**
 * APPROVALS — every gated action across the operator's workspaces. Approve /
 * Decline go through the existing endpoint, which resolves each request
 * exactly once and re-checks RERA, the AI label and the tool before it runs.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ ws?: string; show?: string }> }) {
  const rep = await requireRep();
  const { ws, show } = await searchParams;
  const [spaces, current] = await Promise.all([myWorkspaces(rep.repId), myWorkspace(rep.repId, ws)]);
  const rows = await approvalsFor(rep.repId, current?.id);
  const decided = show === "decided";
  const list = rows.filter((r) => (decided ? r.approval.status !== "pending" : r.approval.status === "pending"));
  const q = (s?: string) => `/marketing/harness/approvals?${new URLSearchParams({ ...(current ? { ws: current.id } : {}), ...(s ? { show: s } : {}) })}`;
  return (
    <>
      <PageHeader
        title="Approvals"
        description="Nothing is published, sent, spent or put live without a person. Each card shows exactly what would go out."
        actions={<Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} allowAll /></Suspense>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={q()} className={`rounded-full px-3 py-1.5 text-[13px] ${!decided ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>Waiting ({rows.filter((r) => r.approval.status === "pending").length})</Link>
        <Link href={q("decided")} className={`rounded-full px-3 py-1.5 text-[13px] ${decided ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>Decided ({rows.filter((r) => r.approval.status !== "pending").length})</Link>
      </div>
      {!decided && list.some((r) => r.approval.outbound) && <div className="mb-4"><DryRunBanner /></div>}
      {list.length === 0 ? (
        <Empty title={decided ? "Nothing decided yet" : "Nothing waiting for you"}>{decided ? "" : "When an agent proposes an outbound action, it stops here until you decide."}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map(({ workspace, approval, goalText }) => <ApprovalCard key={approval.id} approval={approval} workspace={workspace} goalText={goalText} />)}
        </div>
      )}
    </>
  );
}

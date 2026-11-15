import { Suspense, type ReactNode } from "react";
import { requireRep } from "@/lib/auth";
import { approvalsFor } from "@/lib/marketing/console/read";
import { AppShell } from "@/app/_shell/AppShell";
import { LiveRefresh } from "@/components/LiveRefresh";
import { HarnessTabs } from "@/components/harness/Nav";

export const dynamic = "force-dynamic";

/**
 * AGENT HARNESS — a destination inside the marketing workspace, not a
 * second app: the same AppShell (one left panel, where "Agent Harness" is a
 * single item), and the harness's sections as a TOP TAB BAR. Every page
 * re-renders from the server every 3 s while visible, so the graph, board
 * and step log follow the agents as they work.
 */
export default async function HarnessLayout({ children }: { children: ReactNode }) {
  const rep = await requireRep();
  const pending = (await approvalsFor(rep.repId)).filter((a) => a.approval.status === "pending").length;
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing" wide>
      <div className="mx-auto max-w-[1520px]">
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-sage-ink">Agent Harness · Operations console</p>
          <LiveRefresh seconds={3} />
        </div>
        <Suspense fallback={<div className="mb-6 h-11 border-b border-line" />}>
          <HarnessTabs pendingApprovals={pending} />
        </Suspense>
        {children}
      </div>
    </AppShell>
  );
}

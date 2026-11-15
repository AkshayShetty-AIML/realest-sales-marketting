import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, bad, body, handle, member, ok, type Params } from "../../../../_shared";

export const dynamic = "force-dynamic";

const Decision = z.object({ decision: z.enum(["approve", "decline"]), note: z.string().max(1000).nullable().optional() });

/**
 * POST { decision, note } — the operator's decision. Resolves exactly once
 * (a second decision gets 409). On approve the action is re-checked (RERA,
 * AI label, tool still enabled, harness on) and run; the paused sub-agent
 * then resumes in the background. Recorded in the audit log either way.
 */
export async function POST(request: Request, { params }: Params<{ workspaceId: string; approvalId: string }>) {
  return handle(async () => {
    const { workspaceId, approvalId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Decision);
    if (input instanceof NextResponse) return input;
    const h = harness();
    if (!(await h.store.scope(m.workspace.id).get("approvals", approvalId))) return bad("not found", 404);
    const r = await h.decide(m.workspace.id, approvalId, input.decision, actorOf(m.session), input.note ?? null);
    if (!r) return bad("this request was already decided", 409);
    return ok({ approval: r.approval, executed: r.executed });
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { harness, renderBoard } from "@/lib/marketing/harness";
import { actorOf, bad, body, handle, member, ok, type Params } from "../../../../_shared";

export const dynamic = "force-dynamic";

type P = Params<{ workspaceId: string; goalId: string }>;

/** GET — RUN STATUS: the goal's task board (todo / doing / done / blocked / failed), each sub-agent's steps, what's left, pending approvals. ?format=text for plain text. */
export async function GET(request: Request, { params }: P) {
  return handle(async () => {
    const { workspaceId, goalId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    const board = await harness().board(m.workspace.id, goalId);
    if (!board) return bad("not found", 404);
    if (new URL(request.url).searchParams.get("format") === "text") return new NextResponse(renderBoard(board), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
    return ok({ board });
  });
}

const Action = z.object({ action: z.enum(["run", "cancel"]) });

/** POST { action: "run" } starts / continues a planned goal; { action: "cancel" } cancels it (pending approvals expire). */
export async function POST(request: Request, { params }: P) {
  return handle(async () => {
    const { workspaceId, goalId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Action);
    if (input instanceof NextResponse) return input;
    const h = harness();
    const goal = await h.store.scope(m.workspace.id).get("goals", goalId);
    if (!goal) return bad("not found", 404);
    if (input.action === "cancel") {
      const cancelled = await h.cancelGoal(m.workspace.id, goalId, actorOf(m.session));
      return cancelled ? ok({ goal: cancelled }) : bad("this goal can't be cancelled now", 409);
    }
    if (!m.workspace.enabled) return bad("The marketing harness is switched off for this workspace.", 409);
    if (!["planned", "blocked"].includes(goal.status)) return bad(`this goal is ${goal.status}`, 409);
    h.startGoal(m.workspace.id, goalId);
    return ok({ started: true }, 202);
  });
}

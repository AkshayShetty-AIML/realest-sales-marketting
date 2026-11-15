import { NextResponse } from "next/server";
import { harness } from "@/lib/marketing/harness";
import { actorOf, bad, handle, member, ok, type Params } from "../../../../_shared";

export const dynamic = "force-dynamic";

/** POST — ROLLBACK to this checkpoint. The current state is checkpointed first (returned as `undo`). */
export async function POST(_request: Request, { params }: Params<{ workspaceId: string; checkpointId: string }>) {
  return handle(async () => {
    const { workspaceId, checkpointId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    const r = await harness().rollback(m.workspace.id, checkpointId, actorOf(m.session));
    return r ? ok({ restored: r.restored.id, undo: r.undo.id }) : bad("not found", 404);
  });
}

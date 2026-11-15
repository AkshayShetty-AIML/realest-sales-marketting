import { NextResponse } from "next/server";
import { harness } from "@/lib/marketing/harness";
import { handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET ?goalId=… — the audit trail / trace, newest first. */
export async function GET(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const goalId = new URL(request.url).searchParams.get("goalId") ?? undefined;
    return ok({ audit: await harness().audit(m.workspace.id, { goalId }) });
  });
}

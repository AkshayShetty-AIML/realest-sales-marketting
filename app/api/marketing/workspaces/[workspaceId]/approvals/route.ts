import { NextResponse } from "next/server";
import { harness } from "@/lib/marketing/harness";
import { handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET ?status=pending — approval requests (actions and suggestions), newest first. */
export async function GET(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return ok({ approvals: await harness().approvals(m.workspace.id, status) });
  });
}

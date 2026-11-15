import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET — checkpoints (without their snapshots), newest first. */
export async function GET(_request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    return ok({ checkpoints: (await harness().checkpoints(m.workspace.id)).map(({ snapshot, ...c }) => ({ ...c, providers: Object.keys(snapshot) })) });
  });
}

/** POST { label, scope? } — snapshot "workspace" (default) or one slice, e.g. "memory:campaign" or "memory:campaign:diwali-2026". */
export async function POST(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, z.object({ label: z.string().min(1).max(160), scope: z.string().min(1).max(200).optional() }));
    if (input instanceof NextResponse) return input;
    const { snapshot, ...checkpoint } = await harness().checkpoint(m.workspace.id, { ...input, actor: actorOf(m.session) });
    return ok({ checkpoint: { ...checkpoint, providers: Object.keys(snapshot) } }, 201);
  });
}

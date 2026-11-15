import { NextResponse } from "next/server";
import { z } from "zod";
import { harness, AUTONOMY_LEVELS } from "@/lib/marketing/harness";
import { actorOf, body, handle, ok, operator } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/marketing/workspaces — the workspaces this operator is a member of. */
export async function GET() {
  return handle(async () => {
    const session = await operator();
    if (session instanceof NextResponse) return session;
    return ok({ workspaces: await harness().workspacesFor(session.repId) });
  });
}

const Create = z.object({
  name: z.string().min(1).max(120),
  builderId: z.string().max(120).nullable().optional(),
  timezone: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
  autonomy: z.enum(AUTONOMY_LEVELS).optional(),
});

/** POST /api/marketing/workspaces — creates a workspace; the creator is its first member. Defaults: off, suggest-only. */
export async function POST(request: Request) {
  return handle(async () => {
    const session = await operator();
    if (session instanceof NextResponse) return session;
    const input = await body(request, Create);
    if (input instanceof NextResponse) return input;
    return ok({ workspace: await harness().createWorkspace({ ...input, members: [session.repId], actor: actorOf(session) }) }, 201);
  });
}

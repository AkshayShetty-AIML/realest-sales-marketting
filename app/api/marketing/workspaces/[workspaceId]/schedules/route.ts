import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, Trigger, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET — this workspace's schedules and event triggers. */
export async function GET(_request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    return ok({ schedules: await harness().schedules(m.workspace.id) });
  });
}

const Create = z.object({ name: z.string().min(1).max(120), trigger: Trigger, goal: z.string().min(3).max(2000) });

/** POST — a scheduled job (cron, workspace timezone) or an event trigger. Each firing submits its goal through the same intake and approval gate. */
export async function POST(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Create);
    if (input instanceof NextResponse) return input;
    return ok({ schedule: await harness().createSchedule(m.workspace.id, input, actorOf(m.session)) }, 201);
  });
}

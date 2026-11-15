import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, bad, body, handle, member, ok, Trigger, type Params } from "../../../../_shared";

export const dynamic = "force-dynamic";

type P = Params<{ workspaceId: string; scheduleId: string }>;

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("run-now") }),
  z.object({ action: z.literal("edit"), name: z.string().min(1).max(120).optional(), trigger: Trigger.optional(), goal: z.string().min(3).max(2000).optional() }),
]);

/** PATCH { action: pause | resume | run-now | edit } */
export async function PATCH(request: Request, { params }: P) {
  return handle(async () => {
    const { workspaceId, scheduleId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Action);
    if (input instanceof NextResponse) return input;
    const h = harness();
    const actor = actorOf(m.session);
    switch (input.action) {
      case "pause":
      case "resume": {
        const s = input.action === "pause" ? await h.pauseSchedule(m.workspace.id, scheduleId, actor) : await h.resumeSchedule(m.workspace.id, scheduleId, actor);
        return s ? ok({ schedule: s }) : bad("not found", 404);
      }
      case "run-now": {
        const r = await h.runScheduleNow(m.workspace.id, scheduleId, actor);
        if (!r) return bad("not found", 404);
        return "skipped" in r ? bad(`not run: ${r.skipped}`, 409) : ok({ goalId: r.goalId, board: await h.board(m.workspace.id, r.goalId) }, 202);
      }
      default: {
        const { action: _action, ...patch } = input;
        void _action;
        const s = await h.editSchedule(m.workspace.id, scheduleId, patch, actor);
        return s ? ok({ schedule: s }) : bad("not found", 404);
      }
    }
  });
}

export async function DELETE(_request: Request, { params }: P) {
  return handle(async () => {
    const { workspaceId, scheduleId } = await params;
    const m = await member(workspaceId);
    if (m instanceof NextResponse) return m;
    return (await harness().deleteSchedule(m.workspace.id, scheduleId, actorOf(m.session))) ? ok({ deleted: true }) : bad("not found", 404);
  });
}

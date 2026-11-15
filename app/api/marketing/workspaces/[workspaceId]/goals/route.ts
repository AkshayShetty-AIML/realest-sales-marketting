import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET — recent goals in this workspace. */
export async function GET(_request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    return ok({ goals: await harness().goals(m.workspace.id) });
  });
}

const Intake = z.object({
  /** The operator's goal, in their words. */
  text: z.string().min(3).max(2000),
  /** false = plan only (dry run). Default true. */
  execute: z.boolean().optional(),
  /** Third-party content to work from (a lead's message, a pasted page) — always treated as untrusted data. */
  attachments: z.array(z.object({ text: z.string().min(1).max(8000), source: z.string().min(1).max(120) })).max(10).optional(),
});

/**
 * POST — GOAL INTAKE. Plans now (the task breakdown is in the response),
 * then runs in the background; poll GET …/goals/:id for the run log.
 */
export async function POST(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Intake);
    if (input instanceof NextResponse) return input;
    const h = harness();
    const goal = await h.submitGoal(m.workspace.id, { text: input.text, execute: input.execute, actor: actorOf(m.session), untrustedAttachments: input.attachments });
    return ok({ goal, board: await h.board(m.workspace.id, goal.id) }, 201);
  });
}

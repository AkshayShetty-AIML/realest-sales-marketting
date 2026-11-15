import { NextResponse } from "next/server";
import { z } from "zod";
import { audit, harness, setToolSetting } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

const Setting = z.object({ tool: z.string().min(1).max(64), enabled: z.boolean().optional(), forceApproval: z.boolean().optional() });

/** PATCH { tool, enabled?, forceApproval? } — disable a tool or make it always ask, in this workspace. Can't loosen a tool's own approval. */
export async function PATCH(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Setting);
    if (input instanceof NextResponse) return input;
    const h = harness();
    const scoped = h.store.scope(m.workspace.id);
    const setting = await setToolSetting(scoped, input.tool, { enabled: input.enabled, forceApproval: input.forceApproval }, new Date().toISOString());
    await audit(scoped, { kind: "tool.setting", actor: actorOf(m.session), detail: `${input.tool}: enabled ${setting.enabled}, forceApproval ${setting.forceApproval}` });
    return ok({ setting });
  });
}

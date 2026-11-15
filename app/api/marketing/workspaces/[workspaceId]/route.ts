import { NextResponse } from "next/server";
import { z } from "zod";
import { automationStatus, effectiveTools, harness, listAgentTypes, AUTONOMY_LEVELS } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, type Params } from "../../_shared";

export const dynamic = "force-dynamic";

/** GET — the workspace, its on/off + autonomy, the registered tools (effective here) and sub-agent types, the engine. */
export async function GET(_request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const tools = (await effectiveTools(harness().store.scope(m.workspace.id))).map(({ tool, enabled, requiresApproval }) => ({
      name: tool.name, description: tool.description, effect: tool.effect, outbound: tool.outbound ?? null, scopes: tool.scopes, enabled, requiresApproval, owner: tool.owner ?? null, mcp: tool.mcp ?? null,
    }));
    const agentTypes = listAgentTypes().map((a) => ({ type: a.type, description: a.description, tools: a.tools, scopes: a.scopes }));
    return ok({ workspace: m.workspace, tools, agentTypes, automation: automationStatus() });
  });
}

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  autonomy: z.enum(AUTONOMY_LEVELS).optional(),
  timezone: z.string().max(64).optional(),
  /** Link to the premium spine's builder (enables premium-backed reads: live project facts, attribution). Unique across workspaces; null unlinks. */
  builderId: z.string().min(1).max(120).nullable().optional(),
  /** Automatic first replies to new leads (low-risk types only). Off by default. */
  autoFirstReply: z.boolean().optional(),
  /** Replaces the member list (the caller stays a member). */
  members: z.array(z.string().min(1).max(120)).max(200).optional(),
});

/** DELETE { confirm: "<exact name>" } — deletes the workspace and all it owns. Refused while it is on or an agent is mid-run. */
export async function DELETE(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, z.object({ confirm: z.string().max(200) }));
    if (input instanceof NextResponse) return input;
    await harness().deleteWorkspace(m.workspace.id, input.confirm, actorOf(m.session));
    return ok({ deleted: true });
  });
}

/** PATCH — on/off, autonomy level, name, timezone, members, automatic first replies. Audited. */
export async function PATCH(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Patch);
    if (input instanceof NextResponse) return input;
    const members = input.members ? Array.from(new Set([...input.members, m.session.repId])) : undefined;
    return ok({ workspace: await harness().updateWorkspace(m.workspace.id, { ...input, members }, actorOf(m.session)) });
  });
}

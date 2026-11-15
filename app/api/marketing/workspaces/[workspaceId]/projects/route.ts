import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { marketing } from "@/lib/premium/marketing-client";
import { catalogue, covers } from "@/lib/marketing/agents/catalogue";
import { bridgeLeadCaptured } from "@/lib/marketing/lead-bridge";
import { actorOf, bad, body, handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

const Input = z.object({ propertyId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/), action: z.enum(["add", "remove"]) });

/**
 * POST { propertyId, action } — CONNECT a building's project page(s) to this
 * workspace: its leads then enrol in their archetype's follow-ups here (each
 * message waits for approval). One workspace per building: refused when
 * another workspace already receives it (by connection or builder link).
 * On "add", earlier project-page leads on that building that went nowhere are
 * enrolled now (each gets its first message as an approval).
 */
export async function POST(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Input);
    if (input instanceof NextResponse) return input;
    const h = harness();
    const current = m.workspace.projects ?? [];
    if (input.action === "remove") {
      return ok({ workspace: await h.updateWorkspace(m.workspace.id, { projects: current.filter((p) => p !== input.propertyId) }, actorOf(m.session)), enrolled: 0 });
    }
    const property = await catalogue()
      .getProperty(input.propertyId)
      .catch(() => null);
    if (!property) return bad("That building isn't in the premium inventory.", 400);
    const other = (await h.store.listWorkspaces()).find((w) => w.id !== m.workspace.id && covers(w, property));
    if (other) return bad(`${property.name}'s leads already go to the workspace "${other.members.includes(m.session.repId) ? other.name : "another workspace"}".`, 409);
    const workspace = await h.updateWorkspace(m.workspace.id, { projects: [...current, property.id] }, actorOf(m.session));

    // Backfill: project-page leads on this building that were captured before it was connected.
    let enrolled = 0;
    for (const lead of await catalogue().leadsFor([property.id], 200)) {
      const a = await marketing.getAttribution(lead.id).catch(() => null);
      if (!a?.archetype || !/^landing_page/.test(a.source ?? "")) continue;
      const before = await h.memory(workspace.id).get("enrolment", `lead-${lead.id}`);
      if (before) continue;
      const r = await bridgeLeadCaptured(a);
      if (r.routed && (await h.memory(workspace.id).get("enrolment", `lead-${lead.id}`))) enrolled += 1;
    }
    return ok({ workspace, enrolled });
  });
}

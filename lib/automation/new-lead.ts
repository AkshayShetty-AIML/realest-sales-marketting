import "server-only";
import type { Lead } from "../premium/contract";
import { catalogue } from "../marketing/agents/catalogue";
import { audit, store } from "../store";
import { harness as appHarness, type Harness } from "../marketing/harness";
import { workspaceForProject } from "../marketing/lead-bridge";
import { firstTouch } from "../marketing/agents/first-touch";
import { autoReply } from "./leads";
import { openFirstReply } from "./response-time";

/**
 * MKT-17 · ONE NEW LEAD, HANDLED ONCE. Called by the new-lead feed
 * (./realtime.ts: premium's "leads" broadcast, polling /leads?since= as the
 * fallback) for every lead that appeared in the shared leads store.
 *
 *   0. its time-to-first-reply row opens (arrival = premium createdAt) —
 *      the row is also the "seen" marker, so a lead is handled once;
 *   1. FIRST REPLY: the marketing first-touch when the lead's workspace has
 *      automatic first replies on (lib/marketing/agents/first-touch.ts);
 *      otherwise the desk's grounded instant reply, as before. Both take the
 *      same per-lead lock, so a lead never gets two first replies;
 *   2. raises `lead.created` in the lead's workspace → the funnel agent tags,
 *      scores, sets the archetype, enrols and notifies the rep
 *      (lib/marketing/agents/lead-intake.ts). No workspace → the lead's
 *      timeline says so.
 */
export async function handleNewLead(lead: Lead, trigger: string, h: Harness = appHarness(), deskReply: typeof autoReply = autoReply): Promise<{ handled: boolean; workspaceId: string | null; firstReply: string }> {
  if (await store().getFirstReply(lead.id)) return { handled: false, workspaceId: null, firstReply: "already seen" };
  const target = await workspaceForProject(lead.propertyId, h).catch(() => null);
  const workspaceId = target?.workspace.id ?? null;
  const campaignId = (await catalogue().attribution(lead.id).catch(() => null))?.campaignId ?? null;
  await openFirstReply({ leadId: lead.id, arrivedAt: lead.createdAt, workspaceId, campaignId });
  await audit("lead-arrived", lead.id, "new-lead-trigger", `new lead in the shared leads store (${trigger})${target ? ` → workspace ${target.workspace.name}` : " — no marketing workspace receives this project's leads"}`);

  let firstReply = "desk";
  if (workspaceId) {
    try {
      const r = await firstTouch(h.store, workspaceId, lead.id, { trigger });
      firstReply = r.status === "off" ? `desk (first touch off: ${r.reason})` : `first touch: ${r.status}`;
    } catch (error) {
      // The lead's lock may be taken — no desk fallback, so the buyer can't get two first replies.
      firstReply = "first touch failed";
      await audit("first-touch-failed", lead.id, "new-lead-trigger", error instanceof Error ? error.message : "unknown");
    }
  }
  if (firstReply.startsWith("desk") && lead.status === "new" && !(await store().getAutoReply(lead.id))) {
    try {
      const r = await deskReply(lead.id, trigger);
      firstReply = r.done ? `desk: ${r.reply.outcome} via ${r.reply.channel}` : `desk skipped — ${r.skipped}`;
    } catch (error) {
      firstReply = "desk reply failed";
      console.warn(`[new-lead] ${lead.id}: instant reply failed — ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  if (workspaceId) await h.emit(workspaceId, "lead.created", { leadId: lead.id, propertyId: lead.propertyId, trigger });
  return { handled: true, workspaceId, firstReply };
}

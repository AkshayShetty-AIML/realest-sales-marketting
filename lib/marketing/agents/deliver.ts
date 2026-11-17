import "server-only";
import { deliver } from "../../automation/delivery";
import { renderFor } from "../../automation/vars";
import { premium } from "../../premium/client";
import { reraLine } from "../facts";

/**
 * IN-APP DELIVERY for the marketing harness — through the desk's existing
 * one-place sender (lib/automation/delivery.ts → deliver(…, "in_app")):
 * POST /leads/:id/messages on premium, which writes the lead's conversation
 * thread (lead_messages — what the sales desk shows) AND the prospect's in-app
 * inbox (dm_messages). The approved human-written template is rendered for
 * this lead (name, project, price… from the spine record — never invented)
 * and closes with its RERA line.
 *
 * ONLY in_app is live. External channels never come here: they stay dry-run
 * until connected (lib/marketing/agents/tools.ts → sendOutbound).
 * SEAM: setInAppDeliverer() for tests.
 */

export interface InAppDeliverer {
  /** `complianceLine` (an exemption statement) replaces the RERA line when given. */
  deliver(input: { leadId: string; template: string; reraRegNo: string; complianceLine?: string; sentBy: string }): Promise<{ premiumMessageId: string | null; body: string }>;
}

export const premiumInAppDeliverer: InAppDeliverer = {
  async deliver({ leadId, template, reraRegNo, complianceLine, sentBy }) {
    const lead = await premium.getLead(leadId);
    const body = `${await renderFor(template, { lead })}\n\n${complianceLine ?? reraLine(reraRegNo)}`;
    const result = await deliver(leadId, "in_app", body, sentBy);
    if (result.status !== "sent") throw new Error(result.note ?? "in-app delivery failed");
    return { premiumMessageId: result.premiumMessageId, body };
  },
};

const g = globalThis as unknown as { __harnessInApp?: InAppDeliverer };
export const inAppDeliverer = (): InAppDeliverer => g.__harnessInApp ?? premiumInAppDeliverer;
export function setInAppDeliverer(next: InAppDeliverer | null): void {
  g.__harnessInApp = next ?? undefined;
}

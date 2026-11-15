import "server-only";
import { marketing } from "../premium/marketing-client";
import type { ObjectType, PublishStatus, SocialChannel } from "../premium/marketing-contract";
import { audit } from "../store";

/**
 * THE APPROVAL GATE, console side. The STATE and the rules live in the spine
 * (POST /api/internal/marketing/transitions: legal moves, RERA / advertising
 * checks on approval, approval required for scheduled / published, audit).
 * This module only asks for moves.
 *
 * ── BUILDER-APPROVAL SEAM ────────────────────────────────────────────────
 * The builder must approve what goes out under their name. Their approval UI
 * is deferred, so an OPERATOR stands in (approvalVia "operator_stub") and the
 * audit says so. TODO(builder-approval): implement BuilderApprover with a
 * builder-portal approver (approvalVia "builder_portal", actor = the builder
 * user) and swap it in at `approver` below — the spine needs no change.
 */

export interface BuilderApprover {
  /** How the spine records who stood behind the approval. */
  readonly via: "operator_stub" | "builder_portal";
  /** submitted → approved, on the builder's behalf. */
  approve(objectType: ObjectType, objectId: string, actor: string, note?: string): ReturnType<typeof marketing.transition>;
}

/** Today's stand-in: our operator approves on the builder's behalf — labelled as such everywhere. */
export const operatorStubApprover: BuilderApprover = {
  via: "operator_stub",
  approve: (objectType, objectId, actor, note) =>
    marketing.transition({ objectType, objectId, to: "approved", actor, approvalVia: "operator_stub", note: note ?? "approved by the operator on the builder's behalf (builder approval UI deferred)" }),
};

/** TODO(builder-approval): replace with the builder-portal approver when that UI lands. */
export const approver: BuilderApprover = operatorStubApprover;

export async function move(objectType: ObjectType, objectId: string, to: PublishStatus, actor: string, extra: { note?: string; scheduledAt?: string; publishChannels?: SocialChannel[] } = {}) {
  const result = to === "approved" ? await moveToApproved(objectType, objectId, actor, extra.note) : await marketing.transition({ objectType, objectId, to, actor, ...extra });
  await audit("marketing-transition", null, actor, `${objectType} ${objectId} → ${to}${to === "approved" ? ` (via ${approver.via})` : ""}`);
  return result;
}

/** → approved: from submitted it is an APPROVAL (through the approver seam); from scheduled it is an unschedule. */
async function moveToApproved(objectType: ObjectType, objectId: string, actor: string, note?: string) {
  const current = await marketing.compliance(objectType, objectId);
  if (current.status === "submitted") return approver.approve(objectType, objectId, actor, note);
  return marketing.transition({ objectType, objectId, to: "approved", actor, approvalVia: approver.via, note });
}

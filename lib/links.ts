import "server-only";
import { randomBytes } from "node:crypto";
import { publicBaseUrl } from "./env";
import { store } from "./store";
import type { LinkPurpose, LinkToken } from "./store/types";

/**
 * BUYER LINKS — short, random (128-bit), single-purpose, expiring tokens kept
 * in the sales store, so a link reveals nothing and can be revoked. Sent to
 * the buyer as in_app messages; opened at /b/<token>.
 */

const TTL_DAYS: Record<LinkPurpose, number> = { book: 14, visit: 30, feedback: 21, brochure: 30 };

export async function mintLink(purpose: LinkPurpose, leadId: string, visitId: string | null = null, now = new Date(), brochureId: string | null = null): Promise<string> {
  const token = randomBytes(16).toString("base64url");
  const link: LinkToken = {
    token,
    purpose,
    leadId,
    visitId,
    brochureId,
    expiresAt: new Date(now.getTime() + TTL_DAYS[purpose] * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
    usedAt: null,
  };
  await store().addLink(link);
  return `${publicBaseUrl()}/b/${token}`;
}

export type ResolvedLink = { ok: true; link: LinkToken } | { ok: false; reason: "unknown" | "expired" };

export async function resolveLink(token: string): Promise<ResolvedLink> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, reason: "unknown" };
  const link = await store().getLink(token);
  if (!link) return { ok: false, reason: "unknown" };
  if (Date.parse(link.expiresAt) < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, link };
}

/** A buyer link to one personalised brochure (opens /b/<token>, PDF at /b/<token>/brochure.pdf). */
export const mintBrochureLink = (leadId: string, brochureId: string, now = new Date()) => mintLink("brochure", leadId, null, now, brochureId);

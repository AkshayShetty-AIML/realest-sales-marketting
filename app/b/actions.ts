"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveLink, mintLink } from "@/lib/links";
import { bookVisit, cancelVisit, checkIn, confirmAttendance, findVisit, rescheduleVisit, submitFeedback, VisitError } from "@/lib/automation/visits";
import { OBJECTIONS } from "@/lib/buyer-options";
import { store } from "@/lib/store";
import type { LinkPurpose } from "@/lib/store/types";
import { formatDistance } from "@/lib/scheduling/geo";

/**
 * BUYER actions behind /b/<token>. No rep session: the token IS the
 * credential, so every action re-resolves it and checks it's the right
 * purpose for the right lead/visit before doing anything. Errors are plain
 * sentences; nothing internal leaks.
 */

export type BuyerResult = { ok: true; message: string; next?: string } | { ok: false; error: string };

async function guard<T>(token: string, purposes: LinkPurpose[], work: (link: { leadId: string; visitId: string | null }) => Promise<T>): Promise<T | BuyerResult> {
  const resolved = await resolveLink(token);
  if (!resolved.ok) return { ok: false, error: resolved.reason === "expired" ? "This link has expired — ask us for a new one in your inbox." : "This link isn't valid." };
  if (!purposes.includes(resolved.link.purpose)) return { ok: false, error: "This link can't do that." };
  return work(resolved.link);
}

const fail = (error: unknown): BuyerResult => ({ ok: false, error: error instanceof VisitError ? error.message : "Something went wrong — please try again." });
const Slot = z.string().datetime({ offset: true });

export async function bookAction(token: string, slot: string): Promise<BuyerResult> {
  const r = await guard(token, ["book", "visit"], async (link) => {
    try {
      const rec = await bookVisit({ leadId: link.leadId, slot: Slot.parse(slot), source: "self-booking", actor: "visitor" });
      await store().touchLink(token, new Date().toISOString());
      revalidatePath(`/b/${token}`);
      return { ok: true as const, message: "Booked and confirmed.", next: await mintLink("visit", link.leadId, rec.visitId) };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

export async function rescheduleAction(token: string, slot: string): Promise<BuyerResult> {
  const r = await guard(token, ["visit"], async (link) => {
    if (!link.visitId) return { ok: false as const, error: "No visit on this link." };
    try {
      const rec = await rescheduleVisit(link.visitId, Slot.parse(slot), "visitor");
      return { ok: true as const, message: "Rescheduled and confirmed.", next: await mintLink("visit", link.leadId, rec.visitId) };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

export async function confirmAction(token: string): Promise<BuyerResult> {
  const r = await guard(token, ["visit"], async (link) => {
    if (!link.visitId) return { ok: false as const, error: "No visit on this link." };
    try {
      await confirmAttendance(link.visitId);
      revalidatePath(`/b/${token}`);
      return { ok: true as const, message: "Thanks — we'll see you there." };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

export async function cancelAction(token: string): Promise<BuyerResult> {
  const r = await guard(token, ["visit"], async (link) => {
    if (!link.visitId) return { ok: false as const, error: "No visit on this link." };
    try {
      await cancelVisit(link.visitId, "visitor");
      revalidatePath(`/b/${token}`);
      return { ok: true as const, message: "Your visit is cancelled. We've sent you a link to pick a new time whenever you like." };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

export async function checkInAction(token: string, lat: number, lng: number, accuracyM: number | null): Promise<BuyerResult> {
  const r = await guard(token, ["visit"], async (link) => {
    if (!link.visitId) return { ok: false as const, error: "No visit on this link." };
    const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100_000).nullable() }).safeParse({ lat, lng, accuracyM });
    if (!coords.success) return { ok: false as const, error: "We couldn't read your location." };
    try {
      const c = await checkIn({ visitId: link.visitId, by: "visitor", ...coords.data });
      revalidatePath(`/b/${token}`);
      return c.onSite
        ? { ok: true as const, message: "You're checked in — welcome! Our team knows you've arrived." }
        : { ok: false as const, error: `You seem to be ${formatDistance(c.distanceM)} from the site. Check in again when you've arrived.` };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

export async function feedbackAction(token: string, input: { interest: string; objections: string[]; rating: number | null; comment: string }): Promise<BuyerResult> {
  const r = await guard(token, ["feedback"], async (link) => {
    if (!link.visitId) return { ok: false as const, error: "No visit on this link." };
    const parsed = z
      .object({
        interest: z.enum(["interested", "maybe", "not_interested"]),
        objections: z.array(z.enum(OBJECTIONS.map((o) => o.value) as [string, ...string[]])).max(6),
        rating: z.number().int().min(1).max(5).nullable(),
        comment: z.string().max(1000),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false as const, error: "Please choose how interested you are." };
    if ((await store().listFeedback({ visitId: link.visitId })).length > 0) return { ok: true as const, message: "We already have your feedback — thank you!" };
    const visit = await findVisit(link.visitId);
    if (!visit) return { ok: false as const, error: "No visit on this link." };
    try {
      await submitFeedback({ visitId: link.visitId, leadId: link.leadId, ...parsed.data, objections: parsed.data.objections as never });
      await store().touchLink(token, new Date().toISOString());
      revalidatePath(`/b/${token}`);
      return { ok: true as const, message: "Thank you — that really helps." };
    } catch (error) {
      return fail(error);
    }
  });
  return r as BuyerResult;
}

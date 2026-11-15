"use server";

import { z } from "zod";
import { requireRepForAction } from "@/lib/auth";
import { premium, PremiumError } from "@/lib/premium/client";
import { marketing } from "@/lib/premium/marketing-client";
import { MAGNETS, QUIZ, type QuizAnswers } from "@/lib/premium/marketing-contract";
import { CONSENT_TEXT, captureLead, type MagnetResult } from "@/lib/marketing/capture";
import { bridgeLeadCaptured } from "@/lib/marketing/lead-bridge";

/**
 * LANDING-PAGE CAPTURE — the one action a buyer's browser can call on a
 * landing page. A PUBLISHED page accepts anyone (like the /b/<token> pages);
 * a draft page accepts only a signed-in roster user (the operator's test
 * capture from the preview). Creates ONE lead on the shared leads table via
 * POST /api/internal/marketing/leads. Errors come back plain, never a stack.
 * TODO(production): add bot protection (captcha / per-IP rate limit) before
 * pages are published to paid traffic.
 */

const enumOf = <K extends keyof typeof QUIZ>(k: K) => z.enum(Object.keys(QUIZ[k].options) as [string, ...string[]]);
const Utm = z.string().trim().max(100).optional().transform((v) => v || undefined);

const CaptureSchema = z.object({
  pageId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/),
  /** The unit picked on the page's availability view (must belong to the page's building). */
  unitId: z.string().regex(/^[A-Za-z0-9_\-:|.]{1,160}$/).optional(),
  magnet: z.enum(MAGNETS),
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  phone: z.string().trim().max(20).optional().transform((v) => v || undefined),
  email: z.string().trim().max(254).optional().transform((v) => v || undefined),
  consent: z.object({ in_app: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean() }),
  utm: z.object({ source: Utm, medium: Utm, campaign: Utm, content: Utm, term: Utm }).optional(),
  answers: z.object({ purpose: enumOf("purpose"), residence: enumOf("residence"), firstHome: enumOf("firstHome"), household: enumOf("household"), currentHome: enumOf("currentHome") }).optional(),
  eligibility: z.object({ monthlyIncome: z.number().min(0).max(1e8), existingEmis: z.number().min(0).max(1e8) }).optional(),
  /** Honeypot: humans never see or fill it. */
  website: z.string().max(0, "Something went wrong.").optional(),
});

export type CaptureResult = { ok: true; leadId: string; campaign: string | null; archetype: string | null; result: MagnetResult } | { ok: false; error: string };

export async function captureAction(input: unknown): Promise<CaptureResult> {
  try {
    const v = CaptureSchema.parse(input);
    if (!v.phone && !v.email) return { ok: false, error: "Give us a phone number or an email so we can reach you." };
    const page = await marketing.getLandingPage(v.pageId);
    const preview = page.status !== "published";
    if (preview) await requireRepForAction();
    // A unit of interest must be a real (non-indicative) unit of THIS page's building — premium checks it too.
    if (v.unitId) {
      const units = page.propertyId ? await premium.listInventory({ buildingId: page.propertyId, limit: 500 }).catch(() => []) : [];
      if (!units.some((u) => u.unitId === v.unitId && !u.indicative)) return { ok: false, error: "That unit isn't available to enquire about — please pick another." };
    }
    const { lead, result } = await captureLead({
      page,
      magnet: v.magnet,
      contact: { name: v.name, phone: v.phone, email: v.email },
      consent: { ...v.consent, text: CONSENT_TEXT },
      utm: v.utm,
      source: preview ? "landing_page_preview" : "landing_page",
      answers: v.answers as QuizAnswers | undefined,
      eligibility: v.eligibility,
      unitId: v.unitId,
    });
    // Into the project's marketing workspace: enrol in the archetype's nurture; step 1 waits for approval.
    await bridgeLeadCaptured(lead);
    return { ok: true, leadId: lead.leadId, campaign: lead.campaignName, archetype: lead.archetype, result };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join(" ") };
    if (error instanceof PremiumError) return { ok: false, error: error.status === 400 ? "Please check your details and try again." : "We couldn't save that just now — please try again in a minute." };
    return { ok: false, error: error instanceof Error && error.message === "Sign in to continue." ? "This page isn't published yet." : "Something went wrong — please try again." };
  }
}

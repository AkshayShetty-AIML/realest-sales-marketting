import "server-only";
import { z } from "zod";
import { call, q } from "./client";
import {
  AttributionReport,
  Audience,
  AuditEntry,
  Broadcast,
  ComplianceResult,
  Publication,
  Spend,
  TransitionResult,
  type ObjectType,
  type SocialChannel,
  Attribution,
  Enrolment,
  BrandKit,
  Campaign,
  ContentAsset,
  LandingPage,
  LogoUpload,
  MediaItem,
  ReelResult,
  Segment,
  type ContentChannel,
  type Magnet,
  type QuizAnswers,
  type ContentType,
  type PublishStatus,
} from "./marketing-contract";

/**
 * The premium spine's MARKETING endpoints (/api/internal/marketing/*), through
 * the same server-only transport as the sales calls (x-service-key, zod at the
 * boundary). Nothing here can set a status: every create is a draft.
 */

export interface BrandKitInput {
  builderName?: string | null;
  logoPath?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  headingFont?: string;
  bodyFont?: string;
  toneOfVoice?: string;
  defaultReraRegNo?: string | null;
  updatedBy?: string;
}

export interface ContentInput {
  type: Exclude<ContentType, "video">;
  title: string;
  body: string;
  campaignId?: string;
  propertyId?: string;
  channel?: ContentChannel;
  reraRegNo?: string;
  aiGenerated?: boolean;
  aiLabel?: string;
  engine?: "llm" | "template" | "human";
  factKeys?: string[];
  createdBy?: string;
}

export interface ReelInput {
  propertyId: string;
  title: string;
  script: string;
  aiLabel: string;
  campaignId?: string;
  spec?: Record<string, unknown>;
  reraRegNo?: string;
  engine?: "llm" | "template" | "human";
  factKeys?: string[];
  createdBy?: string;
}


export interface CaptureInput {
  landingPageId?: string;
  campaignId?: string;
  propertyId?: string;
  /** The unit of interest (a unit of that building) — checked by premium. */
  unitId?: string;
  magnet: Magnet;
  source?: string;
  contact: { name: string; phone?: string; email?: string };
  consent: { in_app: boolean; email: boolean; whatsapp: boolean; sms: boolean; text: string };
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  message?: string;
  answers?: QuizAnswers;
}

export const marketing = {
  getBrandKit: () => call("GET", "/marketing/brand-kit", BrandKit.nullable()),
  saveBrandKit: (input: BrandKitInput) => call("POST", "/marketing/brand-kit", BrandKit, input),
  signLogoUpload: (input: { contentType: string; bytes: number }) => call("POST", "/marketing/brand-kit/logo", LogoUpload, input),

  listCampaigns: (filter: { status?: PublishStatus; propertyId?: string; limit?: number } = {}) => call("GET", `/marketing/campaigns${q(filter)}`, z.array(Campaign)),
  createCampaign: (input: { name: string; objective?: string; propertyId?: string; segmentId?: string; channels?: string[]; budgetInr?: number; startsAt?: string; endsAt?: string; utmCampaign?: string; createdBy?: string }) =>
    call("POST", "/marketing/campaigns", Campaign, input),

  listContent: (filter: { status?: PublishStatus; type?: ContentType; campaignId?: string; propertyId?: string; limit?: number } = {}) => call("GET", `/marketing/content${q(filter)}`, z.array(ContentAsset)),
  createContent: (input: ContentInput) => call("POST", "/marketing/content", ContentAsset, input),

  listLandingPages: (filter: { status?: PublishStatus; campaignId?: string; limit?: number } = {}) => call("GET", `/marketing/landing-pages${q(filter)}`, z.array(LandingPage)),
  createLandingPage: (input: { slug: string; title: string; content: Record<string, unknown>; campaignId?: string; propertyId?: string; reraRegNo?: string; aiGenerated?: boolean; createdBy?: string }) =>
    call("POST", "/marketing/landing-pages", LandingPage, input),

  getLandingPage: (pageId: string) => call("GET", `/marketing/landing-pages/${encodeURIComponent(pageId)}`, LandingPage),
  findLandingPage: (slug: string) => call("GET", `/marketing/landing-pages${q({ slug, limit: 1 })}`, z.array(LandingPage)).then((rows) => rows[0] ?? null),

  /** Attribution (campaign, source, utm, consent, archetype) for leads on the shared table. */
  listAttribution: (filter: { campaignId?: string; ids?: string[]; limit?: number }) =>
    call("GET", `/marketing/leads${q({ campaignId: filter.campaignId, ids: filter.ids?.join(","), limit: filter.limit })}`, z.array(Attribution)),
  /** Attribution for many leads, in chunks (keeps each URL short). */
  attributionFor: async (ids: string[]) => {
    const out: z.infer<typeof Attribution>[] = [];
    for (let i = 0; i < ids.length; i += 60) out.push(...(await call("GET", `/marketing/leads${q({ ids: ids.slice(i, i + 60).join(","), limit: 500 })}`, z.array(Attribution))));
    return out;
  },
  getAttribution: (leadId: string) => call("GET", `/marketing/leads/${encodeURIComponent(leadId)}`, Attribution),
  captureLead: (input: CaptureInput) => call("POST", "/marketing/leads", Attribution, input),
  setArchetype: (leadId: string, answers: QuizAnswers, by?: string) => call("POST", `/marketing/leads/${encodeURIComponent(leadId)}/archetype`, Attribution, { answers, by }),
  enrol: (input: { campaignId: string; leadId: string; sequenceId?: string; enrolledBy?: string }) => call("POST", "/marketing/enrolments", Enrolment, input),
  listEnrolments: (filter: { campaignId?: string; leadId?: string; limit?: number } = {}) => call("GET", `/marketing/enrolments${q(filter)}`, z.array(Enrolment)),

  // ── Approval gate + distribution (Batch M3) ──
  transition: (input: { objectType: ObjectType; objectId: string; to: PublishStatus; actor: string; approvalVia?: "operator_stub" | "builder_portal"; note?: string; scheduledAt?: string; publishChannels?: SocialChannel[] }) =>
    call("POST", "/marketing/transitions", TransitionResult, input),
  compliance: (objectType: ObjectType, objectId: string) => call("GET", `/marketing/compliance${q({ objectType, objectId })}`, ComplianceResult),
  listAudit: (filter: { objectType?: ObjectType; objectId?: string; limit?: number } = {}) => call("GET", `/marketing/audit${q(filter)}`, z.array(AuditEntry)),
  listPublications: (filter: { assetId?: string; limit?: number } = {}) => call("GET", `/marketing/publications${q(filter)}`, z.array(Publication)),
  addSpend: (input: { campaignId: string; channel: string; amountInr: number; reach?: number; spentOn?: string; source?: "manual" | "builder_passthrough"; note?: string; enteredBy?: string }) => call("POST", "/marketing/spend", Spend, input),
  listSpend: (filter: { campaignId?: string; limit?: number } = {}) => call("GET", `/marketing/spend${q(filter)}`, z.array(Spend)),
  attribution: (filter: { campaignId?: string } = {}) => call("GET", `/marketing/attribution${q(filter)}`, AttributionReport),
  createBroadcast: (input: { segmentId: string; channel: "email" | "whatsapp"; name: string; body: string; subject?: string; waTemplateName?: string; waTemplateLanguage?: string; waTemplateVariables?: string[]; campaignId?: string; createdBy?: string }) =>
    call("POST", "/marketing/broadcasts", Broadcast, input),
  listBroadcasts: (filter: { campaignId?: string; limit?: number } = {}) => call("GET", `/marketing/broadcasts${q(filter)}`, z.array(Broadcast)),
  audience: (broadcastId: string) => call("GET", `/marketing/broadcasts/${encodeURIComponent(broadcastId)}/audience`, Audience),
  recordDeliveries: (broadcastId: string, input: { actor: string; results: { leadId: string; status: "sent" | "failed" | "pending_twilio" | "skipped"; note?: string }[] }) =>
    call("POST", `/marketing/broadcasts/${encodeURIComponent(broadcastId)}/deliveries`, Broadcast, input),

  listSegments: (filter: { limit?: number } = {}) => call("GET", `/marketing/segments${q(filter)}`, z.array(Segment)),
  createSegment: (input: { name: string; description?: string; rules?: Record<string, unknown>; createdBy?: string }) => call("POST", "/marketing/segments", Segment, input),

  createReel: (input: ReelInput) => call("POST", "/marketing/reels", ReelResult, input),
  listMedia: (filter: { status?: "processing" | "ready" | "failed"; limit?: number } = {}) => call("GET", `/marketing/media${q(filter)}`, z.array(MediaItem)),
};

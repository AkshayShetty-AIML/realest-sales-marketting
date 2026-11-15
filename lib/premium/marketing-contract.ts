import { z } from "zod";

/**
 * THE MARKETING CONTRACT, as consumed — /api/internal/marketing/* on the
 * premium spine. Enums copied verbatim from the premium app
 * (lib/server/internal/marketing-schemas.ts; migration 20261005000100). Pure:
 * safe for client components.
 */

export const PUBLISH_STATUSES = ["draft", "submitted", "approved", "scheduled", "published"] as const;
export const CONTENT_TYPES = ["social_post", "caption", "ad_copy", "image", "video"] as const;
export const CONTENT_CHANNELS = ["instagram", "facebook", "linkedin", "google_ads", "meta_ads", "whatsapp", "email", "in_app"] as const;
export const CAMPAIGN_CHANNELS = ["in_app", "email", "whatsapp", "sms", "social", "search", "display"] as const;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type PublishStatus = (typeof PUBLISH_STATUSES)[number];
export type ContentType = (typeof CONTENT_TYPES)[number];
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export const PUBLISH_STATUS_LABEL: Record<PublishStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
};

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  social_post: "Social post",
  caption: "Caption",
  ad_copy: "Ad copy",
  image: "Image",
  video: "Reel / video",
};

export const BrandKit = z.object({
  builderName: z.string().nullable(),
  logoPath: z.string().nullable(),
  logoUrl: z.string().nullable(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  headingFont: z.string(),
  bodyFont: z.string(),
  toneOfVoice: z.string(),
  defaultReraRegNo: z.string().nullable(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});

export const Segment = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  rules: z.record(z.string(), z.unknown()),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const Campaign = z
  .object({
    id: z.string(),
    name: z.string(),
    objective: z.string(),
    propertyId: z.string().nullable(),
    segmentId: z.string().nullable(),
    channels: z.array(z.string()),
    budgetInr: z.number().nullable(),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    utmCampaign: z.string().nullable(),
    status: z.enum(PUBLISH_STATUSES),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    leads: z.object({ total: z.number(), bookings: z.number() }),
  })
  .passthrough();

export const ContentAsset = z
  .object({
    id: z.string(),
    campaignId: z.string().nullable(),
    propertyId: z.string().nullable(),
    type: z.enum(CONTENT_TYPES),
    channel: z.string().nullable(),
    title: z.string(),
    body: z.string(),
    reraRegNo: z.string(),
    aiGenerated: z.boolean(),
    aiLabel: z.string().nullable(),
    engine: z.string().nullable(),
    factKeys: z.array(z.string()),
    status: z.enum(PUBLISH_STATUSES),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    scheduledAt: z.string().nullable().optional(),
    publishChannels: z.array(z.string()).optional(),
    approvedAt: z.string().nullable().optional(),
    approvedBy: z.string().nullable().optional(),
    approvalVia: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
  })
  .passthrough();

export const LandingPage = z
  .object({
    id: z.string(),
    campaignId: z.string().nullable(),
    propertyId: z.string().nullable(),
    slug: z.string(),
    title: z.string(),
    content: z.record(z.string(), z.unknown()),
    reraRegNo: z.string(),
    aiGenerated: z.boolean(),
    status: z.enum(PUBLISH_STATUSES),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const MediaItem = z.object({
  id: z.string(),
  kind: z.string(),
  assetId: z.string().nullable(),
  jobId: z.string().nullable(),
  status: z.enum(["processing", "ready", "failed"]),
  storagePath: z.string().nullable(),
  label: z.string(),
  aiGenerated: z.boolean(),
  demo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LogoUpload = z.object({ path: z.string(), uploadUrl: z.string(), publicUrl: z.string() });

export const ReelResult = z.object({
  asset: ContentAsset,
  job: z.object({ id: z.string(), kind: z.string(), status: z.string(), demo: z.boolean(), createdAt: z.string() }),
  media: MediaItem,
});

export type BrandKit = z.infer<typeof BrandKit>;
export type Segment = z.infer<typeof Segment>;
export type Campaign = z.infer<typeof Campaign>;
export type ContentAsset = z.infer<typeof ContentAsset>;
export type LandingPage = z.infer<typeof LandingPage>;
export type MediaItem = z.infer<typeof MediaItem>;

// ─── Lead capture, archetype, enrolment (Batch M2) ──────────────────────────
// Copied verbatim from the premium app (lib/server/internal/archetype.ts and
// marketing-schemas.ts). The SPINE classifies; the console only asks.

export const ARCHETYPES = ["investor", "end_user_family", "nri", "first_time", "upgrader"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  investor: "Investor",
  end_user_family: "End-user family",
  nri: "NRI",
  first_time: "First-time buyer",
  upgrader: "Upgrader",
};

export const QUIZ = {
  purpose: { label: "What is this home for?", options: { live: "To live in", invest: "To rent out / as an investment", both: "Both" } },
  residence: { label: "Where do you live today?", options: { same_city: "In this city", other_city: "Elsewhere in India", abroad: "Outside India" } },
  firstHome: { label: "Is this your first home purchase?", options: { yes: "Yes", no: "No" } },
  household: { label: "Who will live there?", options: { single: "Just me / a couple", family: "Family with children", other: "Someone else (tenants, parents…)" } },
  currentHome: { label: "Your current home", options: { rent: "I rent", own_upgrade: "I own a smaller home and want to move up", own_keep: "I own and will keep it" } },
} as const;

export type QuizAnswers = { [K in keyof typeof QUIZ]: keyof (typeof QUIZ)[K]["options"] };

export const MAGNETS = ["brochure", "price_list", "eligibility", "register_interest"] as const;
export type Magnet = (typeof MAGNETS)[number];
export const MAGNET_LABEL: Record<Magnet, string> = {
  brochure: "Download the brochure",
  price_list: "Get the price list",
  eligibility: "Check home-loan eligibility",
  register_interest: "Register interest",
};

export const Attribution = z.object({
  leadId: z.string(),
  propertyId: z.string(),
  propertyName: z.string(),
  contactName: z.string().nullable(),
  status: z.string(),
  stage: z.string(),
  campaignId: z.string().nullable(),
  campaignName: z.string().nullable(),
  landingPageId: z.string().nullable(),
  source: z.string().nullable(),
  utm: z.object({ source: z.string().nullable(), medium: z.string().nullable(), campaign: z.string().nullable(), content: z.string().nullable(), term: z.string().nullable() }),
  attributedAt: z.string().nullable(),
  magnet: z.string().nullable(),
  consent: z.object({ in_app: z.boolean(), email: z.boolean(), whatsapp: z.boolean(), sms: z.boolean(), text: z.string().nullable(), at: z.string().nullable() }).nullable(),
  archetype: z.enum(ARCHETYPES).nullable(),
  archetypeReason: z.string().nullable(),
  archetypeAt: z.string().nullable(),
  createdAt: z.string(),
});

export const Enrolment = z.object({
  id: z.string(),
  campaignId: z.string(),
  leadId: z.string(),
  archetype: z.enum(ARCHETYPES),
  sequenceId: z.string().nullable(),
  enrolledBy: z.string(),
  createdAt: z.string(),
});

export type Attribution = z.infer<typeof Attribution>;
export type Enrolment = z.infer<typeof Enrolment>;

// ─── Approval gate, distribution, attribution (Batch M3) ────────────────────

export const OBJECT_TYPES = ["content", "landing_page", "campaign", "broadcast"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export const SOCIAL_CHANNELS = ["instagram", "facebook", "linkedin", "youtube"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

/** Copied from the spine (marketing-schemas.ts TRANSITIONS) — offer only legal moves. */
export const TRANSITIONS: Record<PublishStatus, readonly PublishStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "draft"],
  approved: ["scheduled", "published", "draft"],
  scheduled: ["published", "approved"],
  published: [],
};

export const Check = z.object({ rule: z.string(), ok: z.boolean(), detail: z.string() });
export const ComplianceResult = z.object({ objectType: z.enum(OBJECT_TYPES), objectId: z.string(), status: z.enum(PUBLISH_STATUSES), ok: z.boolean(), checks: z.array(Check) });
export const TransitionResult = z.object({ object: z.object({ id: z.string(), status: z.enum(PUBLISH_STATUSES) }).passthrough(), checks: z.array(Check) });

export const AuditEntry = z.object({
  id: z.string(),
  objectType: z.enum(OBJECT_TYPES),
  objectId: z.string(),
  action: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  actor: z.string(),
  approvalVia: z.string().nullable(),
  note: z.string().nullable(),
  checks: z.array(Check).nullable(),
  ok: z.boolean(),
  at: z.string(),
});

export const Publication = z.object({ id: z.string(), assetId: z.string(), channel: z.string(), status: z.string(), externalId: z.string().nullable(), note: z.string().nullable(), publishedAt: z.string() });

export const Spend = z.object({ id: z.string(), campaignId: z.string(), channel: z.string(), amountInr: z.number(), reach: z.number().nullable(), spentOn: z.string(), source: z.string(), note: z.string().nullable(), enteredBy: z.string(), createdAt: z.string() });

const Metrics = z.object({
  spendInr: z.number(),
  reach: z.number(),
  leads: z.number(),
  visitsBooked: z.number(),
  siteVisits: z.number(),
  bookings: z.number(),
  costPerLead: z.number().nullable(),
  costPerSiteVisit: z.number().nullable(),
  costPerBooking: z.number().nullable(),
});
export const AttributionReport = z.object({
  campaigns: z.array(Metrics.extend({ campaignId: z.string(), name: z.string(), status: z.enum(PUBLISH_STATUSES), budgetInr: z.number().nullable() })),
  channels: z.array(Metrics.extend({ channel: z.string() })),
  totals: Metrics.nullable(),
  definitions: z.record(z.string(), z.string()),
});

export const Broadcast = z
  .object({
    id: z.string(),
    campaignId: z.string().nullable(),
    segmentId: z.string(),
    channel: z.enum(["email", "whatsapp"]),
    name: z.string(),
    subject: z.string().nullable(),
    body: z.string(),
    waTemplate: z.object({ name: z.string(), language: z.string().nullable(), variables: z.array(z.string()) }).nullable(),
    reraRegNo: z.string(),
    status: z.enum(PUBLISH_STATUSES),
    deliveries: z.record(z.string(), z.number()),
    approvedAt: z.string().nullable(),
    approvedBy: z.string().nullable(),
    publishedAt: z.string().nullable(),
  })
  .passthrough();

export const Audience = z.object({
  broadcastId: z.string(),
  channel: z.enum(["email", "whatsapp"]),
  status: z.enum(PUBLISH_STATUSES),
  matched: z.number(),
  eligible: z.array(z.string()),
  skipped: z.object({ noConsent: z.number(), noAddress: z.number() }),
  capped: z.boolean(),
  ignoredRules: z.array(z.string()),
});

export type Check = z.infer<typeof Check>;
export type AuditEntry = z.infer<typeof AuditEntry>;
export type AttributionReport = z.infer<typeof AttributionReport>;
export type Broadcast = z.infer<typeof Broadcast>;
export type Spend = z.infer<typeof Spend>;

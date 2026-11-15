import { z } from "zod";

/**
 * THE PREMIUM CONTRACT, as consumed. The enum sets are copied verbatim from
 * the premium app (lib/server/internal/schemas.ts there; SUPABASE_SETUP §8) —
 * this app never invents a value. Response shapes are parsed with zod on the
 * way in, so a contract drift fails loudly at the boundary instead of
 * rendering garbage. Pure: no server imports, safe for client components.
 */

export const LEAD_STATUSES = ["new", "open", "in_progress", "on_hold", "won", "lost"] as const;
export const LEAD_STAGES = ["inquiry", "qualified", "visit_scheduled", "visit_done", "negotiation", "booking"] as const;
export const CHANNELS = ["whatsapp", "sms", "email", "call", "in_app"] as const;
export const VISIT_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;
export const UNIT_STATUSES = ["available", "blocked", "sold"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type Channel = (typeof CHANNELS)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/** Premium's visit transition rules (terminal states are final). Used to offer only legal moves. */
export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  scheduled: ["confirmed", "completed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const STAGE_LABEL: Record<LeadStage, string> = {
  inquiry: "Inquiry",
  qualified: "Qualified",
  visit_scheduled: "Visit scheduled",
  visit_done: "Visit done",
  negotiation: "Negotiation",
  booking: "Booking",
};

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  won: "Won",
  lost: "Lost",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  call: "Call",
  in_app: "In-app",
};

// ─── Response schemas (what /api/internal/* returns) ────────────────────────

const PropertySummary = z.object({
  id: z.string(),
  name: z.string(),
  builder: z.string(),
  locality: z.string(),
  city: z.string(),
  propertyType: z.string(),
  config: z.string().nullable(),
  salePrice: z.number().nullable(),
  /** Premium omits it on sale-only listings — read as null. */
  rentPerMonth: z.number().nullable().default(null),
});

export const Visit = z.object({
  id: z.string(),
  leadId: z.string(),
  slot: z.string(),
  location: z.string().nullable(),
  status: z.enum(VISIT_STATUSES),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const Lead = z.object({
  id: z.string(),
  propertyId: z.string(),
  kind: z.string(),
  message: z.string(),
  status: z.enum(LEAD_STATUSES),
  stage: z.enum(LEAD_STAGES),
  assignedTo: z.string().nullable(),
  /** Where the lead came from ("landing_page", "concierge", …), its buyer archetype and tags — set by premium; absent on older rows. */
  source: z.string().nullable().default(null),
  archetype: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  buyerId: z.string(),
  listerId: z.string(),
  contact: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    masked: z.boolean(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  context: z.object({
    property: PropertySummary.nullable(),
    nextVisit: Visit.nullable(),
    messageCount: z.number(),
    lastMessageAt: z.string().nullable(),
  }),
});

export const Message = z.object({
  id: z.string(),
  channel: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  sentBy: z.string(),
  createdAt: z.string(),
  source: z.enum(["in_app_thread", "sales_app"]),
});

export const LeadDetail = Lead.extend({
  visits: z.array(Visit),
  messages: z.array(Message),
});

export const Unit = z.object({
  unitId: z.string(),
  projectId: z.string(),
  /** v1 wire value (held is sent as "blocked"). Prefer `availability`. */
  status: z.enum(UNIT_STATUSES),
  price: z.number().nullable(),
  lastVerifiedAt: z.string(),
  // ── canonical unit fields (premium 20261014000200_inventory_leads_foundation) — optional for older premium builds ──
  buildingId: z.string().optional(),
  unitNo: z.string().nullable().optional(),
  label: z.string().optional(),
  config: z.string().nullable().optional(),
  floor: z.number().nullable().optional(),
  facing: z.string().nullable().optional(),
  carpetSqft: z.number().nullable().optional(),
  superBuiltUpSqft: z.number().nullable().optional(),
  availability: z.enum(["available", "held", "sold"]).optional(),
  blockedUntil: z.string().nullable().optional(),
  /** A layout placeholder: its status is illustrative and it states no facts (no facing / area / price). */
  indicative: z.boolean().optional(),
  provenance: z.enum(["verified", "owner_stated", "indicative", "pending"]).optional(),
  /** Per-field provenance, e.g. { facing: "estimate", price: "on_request" }. */
  fieldStatus: z.record(z.string(), z.string()).optional(),
});

/** One physical block of a listing (premium `buildings`), with a fresh inventory summary. */
export const Building = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  towers: z.number().nullable(),
  totalFloors: z.number().nullable(),
  unitsPerFloor: z.number().nullable(),
  /** What the builder's documents state — may differ from the modelled units while the layout is indicative. */
  statedTotalUnits: z.number().nullable(),
  layoutStatus: z.enum(["verified", "indicative"]),
  layoutNote: z.string().nullable(),
  updatedAt: z.string(),
  inventory: z.object({ total: z.number(), available: z.number(), held: z.number(), sold: z.number(), indicative: z.number(), lastVerifiedAt: z.string().nullable() }),
});
export type Building = z.infer<typeof Building>;

/**
 * The property record is large (deep data, media); only the fields the sales
 * app grounds replies on are typed — the rest passes through untouched.
 */
export const Property = z
  .object({
    id: z.string(),
    name: z.string(),
    builder: z.string(),
    locality: z.string(),
    city: z.string(),
    propertyType: z.string(),
    availableFor: z.array(z.string()),
    salePrice: z.number().nullable(),
    /** Premium omits it on sale-only listings — read as null. */
  rentPerMonth: z.number().nullable().default(null),
    priceLabel: z.string(),
    pricePerSqftLabel: z.string(),
    config: z.string().optional(),
    areaSqft: z.number(),
    possession: z.string(),
    grade: z.string(),
    gradeScore: z.number().optional(),
    gradeBreakdown: z.object({ delivery: z.number(), legal: z.number(), reviews: z.number() }).partial().optional(),
    verified: z.boolean(),
    trust: z.object({ rera: z.string(), reraNote: z.string().optional(), litigation: z.string() }).passthrough(),
    gatedCommunity: z.boolean(),
    nearMetro: z.boolean(),
    constructionPct: z.number(),
    coords: z.object({ lat: z.number(), lng: z.number() }),
    amenities: z.array(z.object({ kind: z.string(), name: z.string().optional(), condition: z.string() }).passthrough()).optional(),
    inventory: z.object({
      total: z.number(),
      available: z.number(),
      blocked: z.number(),
      sold: z.number(),
      lastVerifiedAt: z.string().nullable(),
    }),
  })
  .passthrough();

export type Lead = z.infer<typeof Lead>;
export type LeadDetail = z.infer<typeof LeadDetail>;
export type Message = z.infer<typeof Message>;
export type Visit = z.infer<typeof Visit>;
export type Unit = z.infer<typeof Unit>;
export type Property = z.infer<typeof Property>;

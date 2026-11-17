import "server-only";
import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";
import { premiumConfig } from "../env";
import {
  Building,
  CreatedLead,
  Lead,
  LeadDetail,
  Message,
  Property,
  Unit,
  Visit,
  type Channel,
  type LeadStage,
  type LeadStatus,
  type UnitStatus,
  type VisitStatus,
} from "./contract";

/**
 * The premium app's INTERNAL API — consumed, never re-implemented. SERVER
 * ONLY: the x-service-key never leaves this process. Every response is
 * validated against lib/premium/contract.ts; a 401 surfaces as a clear
 * configuration error rather than an empty inbox.
 *
 *   GET  /leads (cursor: ?since=<nextCursor>) · GET /leads/:id · GET /properties/:id · GET /inventory · GET /buildings
 *   POST /leads · POST /leads/:id/messages · PATCH /leads/:id · PATCH /inventory/:unitId (verification only)
 *   POST /units/:id/hold · release · sold (the allocation lock) · POST /visits · PATCH /visits/:id
 *
 * Every user-action POST carries an Idempotency-Key (one per action — a retry
 * replays the first answer, never writes twice). Premium's write limit
 * (429 + Retry-After) gets one wait-and-retry with the same key; longer waits
 * come back as a plain "try again in N s".
 */

export class PremiumError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** Seconds, from a 429's Retry-After header. */
  retryAfter: number | null = null;
  /** The error's `details` (e.g. a 409 unit conflict: who holds it, until when). */
  details: unknown = null;
}

export interface CallOptions {
  /** One per user action: premium replays the first answer for a retry with the same key. */
  idempotencyKey?: string;
}

/** A fresh Idempotency-Key (premium: 8–120 chars of A–Z a–z 0–9 _ - : .). */
export const idempotencyKey = (prefix: string) => `${prefix.replace(/[^A-Za-z0-9_\-:.]/g, "-").slice(0, 60)}:${randomUUID()}`;

const Envelope = <T>(data: ZodType<T>) => z.object({ data, requestId: z.string().optional() });
const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
const Meta = z.object({ nextCursor: z.string().nullable().optional(), hasMore: z.boolean().optional() });

export async function call<T>(method: "GET" | "POST" | "PATCH", path: string, schema: ZodType<T>, body?: unknown, options: CallOptions = {}): Promise<T> {
  return (await callMeta(method, path, schema, body, options)).data;
}

/**
 * One polite retry on premium's 429: a GET always, a write only with an
 * Idempotency-Key (so the retry can't write twice). Waits Retry-After, capped at 3 s;
 * a longer wait comes back as "rate_limited" for the person to try again.
 */
export async function callMeta<T>(method: "GET" | "POST" | "PATCH", path: string, schema: ZodType<T>, body?: unknown, options: CallOptions = {}): Promise<{ data: T; meta: z.infer<typeof Meta> }> {
  try {
    return await callOnce(method, path, schema, body, options);
  } catch (error) {
    if (!(error instanceof PremiumError) || error.status !== 429) throw error;
    const wait = error.retryAfter ?? 1;
    if ((method !== "GET" && !options.idempotencyKey) || wait > 3) throw new PremiumError(429, "rate_limited", `The premium app is busy — try again in ${Math.ceil(wait)} s.`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return callOnce(method, path, schema, body, options);
  }
}

async function callOnce<T>(method: "GET" | "POST" | "PATCH", path: string, schema: ZodType<T>, body?: unknown, options: CallOptions = {}): Promise<{ data: T; meta: z.infer<typeof Meta> }> {
  const config = premiumConfig();
  if (!config) throw new PremiumError(503, "not_configured", "PREMIUM_API_BASE / SALES_INTERNAL_API_KEY are not set");
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        "x-service-key": config.serviceKey,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PremiumError(502, "unreachable", `premium API unreachable at ${config.apiBase}`);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorEnvelope.safeParse(json);
    const code = parsed.success ? parsed.data.error.code : "http_error";
    const message = response.status === 401
      ? "premium API refused the x-service-key (401) — check SALES_INTERNAL_API_KEY"
      : parsed.success ? parsed.data.error.message : `premium API ${response.status}`;
    const err = new PremiumError(response.status, code, message);
    err.retryAfter = Number(response.headers.get("retry-after")) || null;
    err.details = parsed.success ? (parsed.data.error.details ?? null) : null;
    throw err;
  }
  const parsed = Envelope(schema).safeParse(json);
  if (!parsed.success) throw new PremiumError(502, "contract_mismatch", `premium ${method} ${path.split("?")[0]} did not match the contract`);
  const meta = Meta.safeParse(json);
  return { data: parsed.data.data, meta: meta.success ? meta.data : {} };
}

export const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const id = (value: string) => encodeURIComponent(value);
/** The first sync cursor (premium: start from the epoch). */
export const SYNC_START = "1970-01-01T00:00:00Z";

export const premium = {
  listLeads: (filter: { since?: string; status?: LeadStatus; assignedTo?: string; limit?: number } = {}) =>
    call("GET", `/leads${q(filter)}`, z.array(Lead)),

  /**
   * ONE PAGE of the lead sync: GET /leads?since=<cursor>, oldest first by
   * (updatedAt, id). Pass `nextCursor` back exactly as received; `hasMore`
   * means call again at once. A v1 ISO time is still accepted as a cursor.
   */
  async syncLeads(cursor: string, limit = 200): Promise<{ leads: Lead[]; nextCursor: string; hasMore: boolean }> {
    const { data, meta } = await callMeta("GET", `/leads${q({ since: cursor, limit })}`, z.array(Lead));
    return { leads: data, nextCursor: meta.nextCursor ?? cursor, hasMore: meta.hasMore ?? data.length === limit };
  },

  /** EVERY lead in the shared store, through the sync cursor (from the start, while hasMore). */
  async listAllLeads(maxPages = 100): Promise<Lead[]> {
    const all = new Map<string, Lead>();
    let cursor = SYNC_START;
    for (let page = 0; page < maxPages; page += 1) {
      const r = await premium.syncLeads(cursor);
      for (const l of r.leads) all.set(l.id, l);
      cursor = r.nextCursor;
      if (!r.hasMore) break;
    }
    return Array.from(all.values());
  },

  /** FND-03: a lead entered by hand. 200 + duplicate:true = that person is already a lead on this project (nothing written). */
  createLead: (
    input: {
      projectId: string;
      unitId?: string;
      contact: { name: string; phone?: string; email?: string };
      source: string;
      notes?: string;
      consent: { given: boolean; at: string; text?: string; channels?: { in_app: boolean; email: boolean; whatsapp: boolean; sms: boolean } };
      createdBy: { service: string; user: string };
    },
    idempotencyKey: string,
  ) => call("POST", "/leads", CreatedLead, input, { idempotencyKey }),

  /** OPS-01: the allocation lock. Each is one locked premium function; a loser gets 409 with who holds it and until when. */
  holdUnit: (unitId: string, input: { actor: string; leadId?: string; expiresAt: string; reason?: string }, idempotencyKey: string) =>
    call("POST", `/units/${id(unitId)}/hold`, Unit, input, { idempotencyKey }),
  releaseUnit: (unitId: string, input: { actor: string; leadId?: string; reason?: string }, idempotencyKey: string) =>
    call("POST", `/units/${id(unitId)}/release`, Unit, input, { idempotencyKey }),
  sellUnit: (unitId: string, input: { actor: string; bookingRef: string; leadId?: string; reason?: string }, idempotencyKey: string) =>
    call("POST", `/units/${id(unitId)}/sold`, Unit, input, { idempotencyKey }),

  /** Contact is MASKED unless includeContact — only the WhatsApp sender asks for it. */
  getLead: (leadId: string, options: { includeContact?: boolean } = {}) =>
    call("GET", `/leads/${id(leadId)}${q({ includeContact: options.includeContact ? "true" : undefined })}`, LeadDetail),

  getProperty: (propertyId: string) => call("GET", `/properties/${id(propertyId)}`, Property),

  listInventory: (filter: { projectId?: string; buildingId?: string; status?: UnitStatus; limit?: number } = {}) => call("GET", `/inventory${q(filter)}`, z.array(Unit)),
  /** Buildings (layout + indicative flag) with a fresh inventory summary each. */
  listBuildings: () => call("GET", `/buildings${q({ limit: 200 })}`, z.array(Building)),

  /** direction "inbound" records a buyer's reply received on WhatsApp/SMS/email (never in_app). */
  appendMessage: (leadId: string, input: { channel: Channel; body: string; sentBy: string; direction?: "outbound" | "inbound" }) =>
    call("POST", `/leads/${id(leadId)}/messages`, Message, input),

  patchLead: (leadId: string, input: { status?: LeadStatus; stage?: LeadStage; assignedTo?: string | null }) =>
    call("PATCH", `/leads/${id(leadId)}`, LeadDetail, input),

  /** A verification sync of a unit's status — never a hold or a sale (those are /units/:id/…). */
  patchUnit: (unitId: string, input: { status: UnitStatus; lastVerifiedAt: string; blockedUntil?: string | null }) =>
    call("PATCH", `/inventory/${id(unitId)}`, Unit, input),

  createVisit: (input: { leadId: string; slot: string; location?: string; createdBy?: string }) => call("POST", "/visits", Visit, input),

  patchVisit: (visitId: string, status: VisitStatus) => call("PATCH", `/visits/${id(visitId)}`, Visit, { status }),
};

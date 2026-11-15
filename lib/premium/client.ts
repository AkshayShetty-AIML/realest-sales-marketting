import "server-only";
import { z, type ZodType } from "zod";
import { premiumConfig } from "../env";
import {
  Building,
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
 *   GET  /leads · GET /leads/:id · GET /properties/:id · GET /inventory
 *   POST /leads/:id/messages · PATCH /leads/:id · PATCH /inventory/:unitId
 *   POST /visits · PATCH /visits/:id
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
}

const Envelope = <T>(data: ZodType<T>) => z.object({ data, requestId: z.string().optional() });
const ErrorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** GETs only: one polite retry when premium's rate limiter says 429 (waits Retry-After, capped at 3 s). */
export async function call<T>(method: "GET" | "POST" | "PATCH", path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
  try {
    return await callOnce(method, path, schema, body);
  } catch (error) {
    if (method !== "GET" || !(error instanceof PremiumError) || error.status !== 429) throw error;
    await new Promise((r) => setTimeout(r, Math.min(3, error.retryAfter ?? 1) * 1000));
    return callOnce(method, path, schema, body);
  }
}

async function callOnce<T>(method: "GET" | "POST" | "PATCH", path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
  const config = premiumConfig();
  if (!config) throw new PremiumError(503, "not_configured", "PREMIUM_API_BASE / SALES_INTERNAL_API_KEY are not set");
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}${path}`, {
      method,
      headers: {
        "x-service-key": config.serviceKey,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
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
    throw err;
  }
  const parsed = Envelope(schema).safeParse(json);
  if (!parsed.success) throw new PremiumError(502, "contract_mismatch", `premium ${method} ${path.split("?")[0]} did not match the contract`);
  return parsed.data.data;
}

export const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const id = (value: string) => encodeURIComponent(value);

export const premium = {
  listLeads: (filter: { since?: string; status?: LeadStatus; assignedTo?: string; limit?: number } = {}) =>
    call("GET", `/leads${q(filter)}`, z.array(Lead)),

  /** EVERY lead in the shared store: pages through /leads?since= (oldest update first, 200 a page). */
  async listAllLeads(maxPages = 50): Promise<Lead[]> {
    const all: Lead[] = [];
    let since = "1970-01-01T00:00:00.000Z";
    for (let page = 0; page < maxPages; page += 1) {
      const rows = await premium.listLeads({ since, limit: 200 });
      all.push(...rows);
      if (rows.length < 200) break;
      since = rows[rows.length - 1].updatedAt;
    }
    const seen = new Set<string>();
    return all.filter((l) => !seen.has(l.id) && seen.add(l.id));
  },

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

  patchUnit: (unitId: string, input: { status: UnitStatus; lastVerifiedAt: string; blockedUntil?: string | null }) =>
    call("PATCH", `/inventory/${id(unitId)}`, Unit, input),

  createVisit: (input: { leadId: string; slot: string; location?: string; createdBy?: string }) => call("POST", "/visits", Visit, input),

  patchVisit: (visitId: string, status: VisitStatus) => call("PATCH", `/visits/${id(visitId)}`, Visit, { status }),
};

import "server-only";
import { premium } from "../premium/client";
import type { Lead, LeadDetail, Property } from "../premium/contract";
import { store } from "../store";
import { scoringModel, type LeadScore } from "./model";

/**
 * Fetches what scoring needs — each lead's detail (thread, visits) and its
 * property — with bounded concurrency, and scores it. Read-only. Used by the
 * inbox (priority sort) and the dashboard.
 */
/**
 * Read-through memo for the views that fan out one premium read per lead
 * (inbox, dashboard): a lead's detail is reused while its list row is
 * unchanged (same updatedAt / message count / last message) for up to
 * DETAIL_TTL_MS; a property for PROPERTY_TTL_MS. Keeps a page refresh well
 * inside premium's rate limit without serving anything stale for long.
 */
const DETAIL_TTL_MS = 15_000;
const PROPERTY_TTL_MS = 60_000;
type Memo<T> = Map<string, { at: number; value: Promise<T> }>;
const g = globalThis as unknown as { __scoringMemo?: { details: Memo<LeadDetail>; properties: Memo<Property> } };
const memo = (g.__scoringMemo ??= { details: new Map(), properties: new Map() });

function cached<T>(map: Memo<T>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = load();
  map.set(key, { at: Date.now(), value });
  value.catch(() => map.delete(key));
  if (map.size > 2000) map.delete(map.keys().next().value as string);
  return value;
}

export interface ScoredLead {
  lead: Lead;
  detail: LeadDetail | null;
  property: Property | null;
  score: LeadScore;
  /** False when premium couldn't be read for this lead — its numbers are partial. */
  complete: boolean;
}

async function pool<T, R>(items: T[], size: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

export async function scoreLeads(leads: Lead[], now = Date.now()): Promise<Map<string, ScoredLead>> {
  const [visits, checkIns, feedback, optIns] = await Promise.all([store().listVisits(), store().listCheckIns(), store().listFeedback(), store().listOptIns()]);
  const properties = new Map<string, Promise<Property | null>>();
  const propertyFor = (id: string) => {
    if (!properties.has(id)) properties.set(id, cached(memo.properties, id, PROPERTY_TTL_MS, () => premium.getProperty(id)).catch(() => null));
    return properties.get(id)!;
  };
  const model = scoringModel();
  const scored = await pool(leads, 6, async (lead): Promise<ScoredLead> => {
    const [detail, property] = await Promise.all([cached(memo.details, `${lead.id}|${lead.updatedAt}|${lead.context.messageCount}|${lead.context.lastMessageAt}`, DETAIL_TTL_MS, () => premium.getLead(lead.id)).catch(() => null), propertyFor(lead.propertyId)]);
    const score = model.score({
      lead: detail ?? { ...lead, visits: [], messages: [] },
      property,
      visits: visits.filter((v) => v.leadId === lead.id),
      checkIns: checkIns.filter((c) => c.leadId === lead.id),
      feedback: feedback.filter((f) => f.leadId === lead.id),
      optIn: optIns.find((o) => o.leadId === lead.id) ?? null,
      now,
    });
    return { lead, detail, property, score, complete: detail !== null };
  });
  return new Map(scored.map((s) => [s.lead.id, s]));
}

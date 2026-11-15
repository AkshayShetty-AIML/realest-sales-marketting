import "server-only";
import { z } from "zod";
import { premium } from "../premium/client";
import { marketing } from "../premium/marketing-client";
import { ARCHETYPES } from "../premium/marketing-contract";
import { LEAD_STAGES, type Lead } from "../premium/contract";
import { scoreLeads } from "../scoring/load";
import type { Band } from "../scoring/model";

/**
 * BUYER LISTS FROM THE SHARED LEADS STORE. A list is RULES only — never a
 * typed-in or hand-picked set of buyers, and never a local copy: members are
 * resolved live from premium's leads (GET /leads, every page) each time.
 *
 * Rules: projects (buildings), buyer archetype, score band (the desk's
 * deterministic model), stage reached, last activity, campaign. Premium
 * stores the list and resolves consent at send time; the rules it does not
 * know (score band, last activity) are applied here, so a send never reaches
 * someone the list excludes (lib/marketing/distribution.ts).
 */

export const SCORE_BANDS = ["hot", "warm", "cold"] as const;

export const ListRules = z
  .object({
    propertyIds: z.array(z.string().min(1).max(160)).max(50).optional(),
    archetypes: z.array(z.enum(ARCHETYPES)).max(5).optional(),
    scoreBands: z.array(z.enum(SCORE_BANDS)).max(3).optional(),
    stageAtLeast: z.enum(LEAD_STAGES).optional(),
    activeWithinDays: z.number().int().min(1).max(365).optional(),
    campaignId: z.string().min(1).max(160).optional(),
  })
  .strict();
export type ListRules = z.infer<typeof ListRules>;

/** Rule keys premium's audience resolver does not apply — enforced here before anything is sent. */
export const LOCAL_RULES = ["scoreBands", "activeWithinDays", "propertyIds"] as const;

/** Rules premium saved before this batch: one project as `propertyId`. Hand-picked / test lists are not rules — they match nobody. */
export function rulesOf(raw: Record<string, unknown>): { rules: ListRules; unsupported: string[] } {
  const unsupported = ["leadIds", "emailDomain"].filter((k) => k in raw);
  const legacy = typeof raw.propertyId === "string" ? { propertyIds: [raw.propertyId] } : {};
  const known = Object.fromEntries(Object.entries({ ...raw, ...legacy }).filter(([k]) => k in ListRules.shape));
  const parsed = ListRules.safeParse(known);
  return { rules: parsed.success ? parsed.data : {}, unsupported: parsed.success ? unsupported : [...unsupported, "rules"] };
}

/** When the buyer last did something: their last message on the thread, else when they enquired. */
export const lastActivity = (lead: Lead) => lead.context.lastMessageAt ?? lead.createdAt;

const stageRank = (s: string) => (LEAD_STAGES as readonly string[]).indexOf(s);

export interface ResolvedList {
  leads: Lead[];
  /** Leads in the shared store that were considered. */
  considered: number;
  bands: Map<string, Band>;
}

/** The list's members, now, from the shared leads store. Closed (won / lost) leads are never on a list. `leads`: one read of the store shared by several lists. */
export async function resolveList(raw: Record<string, unknown>, now = Date.now(), leads?: Lead[]): Promise<ResolvedList> {
  const { rules, unsupported } = rulesOf(raw);
  const all = leads ?? (await premium.listAllLeads());
  if (unsupported.length) return { leads: [], considered: all.length, bands: new Map() };
  const inCampaign = rules.campaignId ? new Set((await marketing.listAttribution({ campaignId: rules.campaignId, limit: 500 })).map((a) => a.leadId)) : null;
  let members = all.filter(
    (l) =>
      l.status !== "won" &&
      l.status !== "lost" &&
      (!rules.propertyIds?.length || rules.propertyIds.includes(l.propertyId)) &&
      (!rules.archetypes?.length || (l.archetype !== null && (rules.archetypes as string[]).includes(l.archetype))) &&
      (!rules.stageAtLeast || stageRank(l.stage) >= stageRank(rules.stageAtLeast)) &&
      (!rules.activeWithinDays || now - Date.parse(lastActivity(l)) <= rules.activeWithinDays * 86_400_000) &&
      (!inCampaign || inCampaign.has(l.id)),
  );
  const bands = new Map<string, Band>();
  if (rules.scoreBands?.length) {
    const scored = await scoreLeads(members, now);
    for (const [id, s] of scored) bands.set(id, s.score.band);
    members = members.filter((l) => (rules.scoreBands as string[]).includes(bands.get(l.id) ?? ""));
  }
  return { leads: members, considered: all.length, bands };
}

import "server-only";
import { premium, PremiumError } from "./premium/client";
import type { Lead } from "./premium/contract";
import { store } from "./store";
import type { AutoReply, ConversationState, OptIn, Rep } from "./store/types";
import { byPriority, type LeadScore } from "./scoring/model";
import { scoreLeads } from "./scoring/load";
import { marketing } from "./premium/marketing-client";
import type { Attribution } from "./premium/marketing-contract";

/**
 * Everything the inbox and pipeline render: premium leads, LIVE from the
 * internal API, + this desk's own state per lead. No premium data is stored.
 */
export interface InboxRow {
  lead: Lead;
  autoReply: AutoReply | null;
  mode: "ai" | "human";
  rep: Rep | null;
  optIn: OptIn["status"] | null;
  needsRep: boolean;
  /** Present when loaded with `{ score: true }`. */
  score: LeadScore | null;
  /** Marketing attribution from the spine (campaign, source, archetype); null when none / unavailable. */
  attribution: Attribution | null;
}

export interface InboxData {
  rows: InboxRow[];
  reps: Rep[];
  error: string | null;
  counts: { inbox: number; needsRep: number };
}

/** `score: true` scores every lead (one premium detail read per lead) and sorts by priority. */
export async function loadInbox(opts: { score?: boolean } = {}): Promise<InboxData> {
  const [reps, replies, conversations, optIns] = await Promise.all([store().listReps(), store().listAutoReplies(), store().listConversations(), store().listOptIns()]);
  let leads: Lead[] = [];
  let error: string | null = null;
  try {
    leads = await premium.listLeads({ limit: 200 });
  } catch (e) {
    error = e instanceof PremiumError ? e.message : "Could not load leads from the premium app.";
  }
  const byLead = <T extends { leadId: string }>(list: T[]) => new Map(list.map((x) => [x.leadId, x]));
  const replyBy = byLead(replies);
  const convBy = byLead<ConversationState>(conversations);
  const optBy = byLead(optIns);
  const repBy = new Map(reps.map((r) => [r.id, r]));
  const scores = opts.score && leads.length ? await scoreLeads(leads) : null;
  // Marketing tags are a garnish: a failure here never blocks the inbox.
  const attributionBy = new Map((leads.length ? await marketing.attributionFor(leads.map((l) => l.id)).catch(() => []) : []).map((a) => [a.leadId, a]));
  const rows: InboxRow[] = leads.map((lead) => {
    const autoReply = replyBy.get(lead.id) ?? null;
    const conv = convBy.get(lead.id);
    return {
      lead,
      autoReply,
      mode: conv?.mode ?? "ai",
      rep: lead.assignedTo ? repBy.get(lead.assignedTo) ?? null : null,
      optIn: optBy.get(lead.id)?.status ?? null,
      needsRep: autoReply?.outcome === "handoff" || autoReply?.outcome === "failed" || Boolean(conv?.suggestedDraft),
      score: scores?.get(lead.id)?.score ?? null,
      attribution: attributionBy.get(lead.id) ?? null,
    };
  });
  if (scores) rows.sort((a, b) => byPriority({ score: a.score!, updatedAt: a.lead.context.lastMessageAt ?? a.lead.createdAt }, { score: b.score!, updatedAt: b.lead.context.lastMessageAt ?? b.lead.createdAt }));
  return {
    rows,
    reps,
    error,
    counts: { inbox: rows.filter((r) => r.lead.status === "new").length, needsRep: rows.filter((r) => r.needsRep).length },
  };
}

/** Sidebar counts for pages that don't load the whole inbox. Never throws. */
export async function navCounts(): Promise<InboxData["counts"] | null> {
  try {
    return (await loadInbox()).counts;
  } catch {
    return null;
  }
}

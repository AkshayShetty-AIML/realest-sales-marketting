/**
 * PLAIN-LANGUAGE VOCABULARY for the marketing workspace — the screens are
 * used by the builder's own team, not by engineers. Every value the spine
 * stores (enums, rule keys, merge fields) is turned into words here, in ONE
 * place, so no raw id / enum / {{field}} reaches a screen. Pure.
 */
import type { PublishStatus } from "../premium/marketing-contract";

// ─── Status ─────────────────────────────────────────────────────────────────

export const STATUS_WORD: Record<PublishStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Live",
};

// ─── Channels, sources, goals ───────────────────────────────────────────────

const CHANNEL_WORD: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google: "Google",
  google_ads: "Google ads",
  meta_ads: "Facebook & Instagram ads",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  in_app: "App message",
  print: "Newspaper / print",
  outdoor: "Hoardings",
  portals: "Property portals",
  referral: "Referral",
  direct: "Direct / unknown",
  preview: "Test (preview)",
  other: "Other",
  social: "Social media",
  search: "Search",
  display: "Banner ads",
};
export const channelWord = (c: string | null | undefined) => (c ? CHANNEL_WORD[c] ?? c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase()) : "—");

/** Where spend can be entered from — a fixed list, never free text. */
export const SPEND_CHANNELS = ["instagram", "facebook", "google", "youtube", "linkedin", "portals", "print", "outdoor", "other"] as const;

const SOURCE_WORD: Record<string, string> = {
  landing_page: "Landing page",
  landing_page_preview: "Test enquiry",
  campaign_enrolment: "Added to campaign",
};
export const sourceWord = (s: string | null | undefined) => (s ? SOURCE_WORD[s] ?? s.replace(/_/g, " ") : "—");

export const MAGNET_DONE: Record<string, string> = {
  brochure: "Downloaded the brochure",
  price_list: "Asked for the price list",
  eligibility: "Checked loan eligibility",
  register_interest: "Registered interest",
};

export const GOALS = [
  { value: "leads", label: "Get enquiries", short: "Enquiries" },
  { value: "site_visits", label: "Get site visits", short: "Site visits" },
  { value: "bookings", label: "Get bookings", short: "Bookings" },
  { value: "awareness", label: "Spread the word", short: "Awareness" },
] as const;
export const goalWord = (g: string) => GOALS.find((x) => x.value === g)?.label ?? g.replace(/_/g, " ");

export const CONTENT_WORD: Record<string, string> = {
  social_post: "Social media post",
  caption: "Short caption",
  ad_copy: "Ad text",
  image: "Image",
  video: "Short video",
};

// ─── Standard campaign name ─────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * THE NAMING STANDARD: "<Project> · <Goal> · <Mon YYYY>", e.g.
 * "Cedar Heights · Site visits · Oct 2026". Builders never type a name; the
 * tracking code (utm_campaign) is derived from the same words.
 */
export function standardCampaignName(project: string, goal: string, month: string /* YYYY-MM */): string {
  const [y, m] = month.split("-").map(Number);
  const short = GOALS.find((g) => g.value === goal)?.short ?? goal;
  return `${project} · ${short} · ${MONTHS[(m || 1) - 1]} ${y}`;
}
export const trackingCode = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

// ─── Friendly placeholders instead of {{merge_fields}} ──────────────────────

/** What a builder types / sees ("[First name]") ⇄ what the sender fills ({{firstName|there}}). */
export const PLACEHOLDERS = [
  { word: "First name", field: "firstName", fallback: "there" },
  { word: "Project name", field: "property", fallback: "" },
  { word: "Area", field: "locality", fallback: "" },
  { word: "Price", field: "price", fallback: "price on request" },
  { word: "Carpet area", field: "carpetArea", fallback: "carpet area on request" },
  { word: "Possession", field: "possession", fallback: "" },
] as const;

export function fromFriendly(text: string): string {
  let out = text;
  for (const p of PLACEHOLDERS) out = out.split(`[${p.word}]`).join(p.fallback ? `{{${p.field}|${p.fallback}}}` : `{{${p.field}}}`);
  return out;
}

export function toFriendly(text: string): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*(?:\|[^}]*)?\}\}/g, (whole, field: string) => {
    const p = PLACEHOLDERS.find((x) => x.field === field);
    return p ? `[${p.word}]` : "[…]";
  });
}

export const usedFields = (text: string) => PLACEHOLDERS.filter((p) => text.includes(`[${p.word}]`)).map((p) => p.field);

// ─── Approval checklist + activity log ──────────────────────────────────────

export const CHECK_WORD: Record<string, string> = {
  rera_present: "RERA number added",
  rera_disclosed: "RERA number shown in the text",
  carpet_area: "Area and price use carpet area",
  no_misleading: "No exaggerated claims or promises",
  no_contact_bait: "No phone numbers or web links",
  ai_labelled: "AI-written content and photos are labelled",
  channel_ready: "Ready to send",
  project: "Linked to a project",
};

export function activityWord(action: string): string {
  const map: Record<string, string> = {
    approved: "approved",
    moved_to_submitted: "sent for approval",
    moved_to_draft: "moved back to draft",
    moved_to_scheduled: "scheduled",
    moved_to_published: "published",
    moved_to_approved: "cancelled the schedule of",
    approval_blocked: "could not approve",
    illegal_transition: "tried to publish before approval:",
    send_blocked: "tried to send before approval:",
    sent: "sent",
    not_approved: "tried to publish before approval:",
    invalid_schedule: "could not schedule",
    invalid_publish: "could not publish",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

// ─── Buyer lists (segments) ─────────────────────────────────────────────────

export const STAGE_ORDER = [
  { value: "inquiry", label: "Enquired" },
  { value: "qualified", label: "Qualified" },
  { value: "visit_scheduled", label: "Visit booked" },
  { value: "visit_done", label: "Visited" },
  { value: "negotiation", label: "Negotiating" },
  { value: "booking", label: "Booked" },
] as const;

/** Score bands a buyer list can pick (the desk's deterministic lead score). */
export const SCORE_BAND_WORD = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;
/** "Active in the last N days" choices for a buyer list. */
export const ACTIVITY_DAYS = [1, 3, 7, 14, 30, 90] as const;

/** A buyer list's rules, as a sentence. Hand-picked or test lists are not rules — they are shown as no longer used. */
export function describeList(rules: Record<string, unknown>, names: { campaigns: Map<string, string>; projects: Map<string, string>; types: Record<string, string> }): string {
  if ("leadIds" in rules || "emailDomain" in rules) return "Hand-picked list — no longer used (lists are built from your leads)";
  const parts: string[] = [];
  const projects = Array.isArray(rules.propertyIds) ? (rules.propertyIds as string[]) : typeof rules.propertyId === "string" ? [rules.propertyId] : [];
  if (Array.isArray(rules.archetypes) && rules.archetypes.length) parts.push((rules.archetypes as string[]).map((a) => names.types[a] ?? a).join(" or "));
  if (projects.length) parts.push(`interested in ${projects.map((p) => names.projects.get(p) ?? "a project").join(" or ")}`);
  if (Array.isArray(rules.scoreBands) && rules.scoreBands.length) parts.push(`scored ${(rules.scoreBands as string[]).map((b) => (SCORE_BAND_WORD[b as keyof typeof SCORE_BAND_WORD] ?? b).toLowerCase()).join(" or ")}`);
  if (typeof rules.stageAtLeast === "string") parts.push(`${(STAGE_ORDER.find((s) => s.value === rules.stageAtLeast)?.label ?? rules.stageAtLeast).toLowerCase()} or further`);
  if (typeof rules.activeWithinDays === "number") parts.push(`active in the last ${rules.activeWithinDays === 1 ? "day" : `${rules.activeWithinDays} days`}`);
  if (typeof rules.campaignId === "string") parts.push(`from “${names.campaigns.get(rules.campaignId) ?? "a campaign"}”`);
  return parts.length ? `Buyers ${parts.join(", ")}` : "All buyers";
}

/** "After 1 day" etc. for follow-up steps. */
export const whenWord = (hours: number) => (hours === 0 ? "Right away" : hours % 24 === 0 ? `After ${hours / 24} day${hours === 24 ? "" : "s"}` : `After ${hours} hours`);

export const JOB_WORD: Record<string, string> = {
  sent: "sent",
  pending: "scheduled",
  running: "sending",
  pending_twilio: "waiting for WhatsApp",
  failed: "not sent",
  cancelled: "stopped",
  skipped: "skipped",
};

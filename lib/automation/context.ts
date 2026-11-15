import type { LeadDetail, Property } from "../premium/contract";
import { topicsOf, TOPIC_LABEL } from "../grounding/compose";

/**
 * LEAD CONTEXT for the inbox — property, person (masked), requirements,
 * behaviour, source — DERIVED from the premium lead (its thread includes inbound WhatsApp), never
 * guessed. A requirement the buyer didn't state is shown as "not stated", not
 * inferred. Pure.
 */

export interface LeadContext {
  person: { name: string; phone: string; email: string; masked: boolean };
  requirements: { label: string; value: string }[];
  behaviour: { label: string; value: string }[];
  source: { label: string; value: string }[];
}

const BHK = /\b([1-6])\s*-?\s*bhk\b/i;
const BUDGET = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|lakh|lakhs|lac|l|k)\b/i;
const TIMELINE = /\b(this|next) (week|weekend|month)\b|\b(immediately|asap|urgent)\b|\b(?:in|within) (\d+) (days|weeks|months|years?)\b/i;

const minutes = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
function duration(mins: number): string {
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
}

export function deriveContext(lead: LeadDetail, property: Property | null, now = Date.now()): LeadContext {
  const text = [lead.message, ...lead.messages.filter((m) => m.direction === "inbound").map((m) => m.body)].join(" \n ");
  const bhk = text.match(BHK);
  const budget = text.match(BUDGET);
  const timeline = text.match(TIMELINE);
  const topics = topicsOf(lead.kind, text);
  const offered = property?.availableFor ?? [];

  const requirements = [
    {
      label: "Intent",
      value: offered.length === 1 ? `${offered[0]} (the only way this home is offered)` : offered.length > 1 ? `not stated (offered for ${offered.join(" / ")})` : "not stated",
    },
    { label: "Configuration", value: bhk ? `${bhk[1]} BHK (stated)` : property?.config ? `not stated (this home is ${property.config})` : "not stated" },
    { label: "Budget", value: budget ? `${budget[0].trim()} (stated)` : "not stated" },
    { label: "Timeline", value: timeline ? `${timeline[0]} (stated)` : "not stated" },
    { label: "Asked about", value: topics.length > 0 ? topics.map((t) => TOPIC_LABEL[t]).join(", ") : "nothing specific" },
  ];

  const inboundCount = lead.messages.filter((m) => m.direction === "inbound").length;
  const outbound = lead.messages.filter((m) => m.direction === "outbound");
  const firstOut = outbound[0];
  const behaviour = [
    { label: "Inquired", value: `${duration(minutes(lead.createdAt, new Date(now).toISOString()))} ago` },
    { label: "Buyer messages", value: String(inboundCount) },
    { label: "Our replies", value: String(outbound.length) },
    { label: "First response", value: firstOut ? duration(minutes(lead.createdAt, firstOut.createdAt)) : "none yet" },
    { label: "Visits", value: lead.visits.length === 0 ? "none" : lead.visits.map((v) => v.status.replace("_", " ")).join(", ") },
  ];

  const source = [
    { label: "Channel", value: `Premium app · ${lead.kind} inquiry` },
    { label: "Addressed to", value: lead.listerId === "listing-desk" ? "listing desk" : `verified pro (${lead.listerId})` },
    { label: "Buyer account", value: lead.buyerId },
  ];

  return {
    person: {
      name: lead.contact.name ?? "not shared",
      phone: lead.contact.phone ?? "not shared",
      email: lead.contact.email ?? "not shared",
      masked: lead.contact.masked,
    },
    requirements,
    behaviour,
    source,
  };
}

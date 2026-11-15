import "server-only";
import { premium } from "../premium/client";
import type { LeadDetail, Property } from "../premium/contract";
import { buildFacts, factValue } from "../grounding/facts";
import { greetingName } from "../grounding/compose";
import { mintLink } from "../links";
import { store } from "../store";
import { formatIst } from "../scheduling/time";
import { neededLinks, renderTemplate, type TemplateVars } from "./templates";
import { carpetSqft } from "../marketing/facts";

/**
 * Fills a template from REAL data: the lead (masked contact → first name
 * only), its property's fact sheet (the same facts the grounded replies use),
 * the visit, and links minted just for this message.
 */
export async function renderFor(
  template: string,
  ctx: { lead: LeadDetail; property?: Property | null; visitId?: string | null },
): Promise<string> {
  const { lead } = ctx;
  const property = ctx.property ?? (await premium.getProperty(lead.propertyId).catch(() => null));
  const facts = property ? buildFacts(property) : [];
  const visitId = ctx.visitId ?? null;
  const visit = visitId ? (await store().listVisits({ leadId: lead.id })).find((v) => v.visitId === visitId) : null;
  const reps = await store().listReps();
  const want = neededLinks(template);
  const vars: TemplateVars = {
    firstName: greetingName(lead.contact.name),
    property: factValue(facts, "name") ?? lead.context.property?.name ?? null,
    locality: factValue(facts, "location"),
    price: factValue(facts, "sale_price"),
    pricePerSqft: factValue(facts, "price_per_sqft"),
    rent: factValue(facts, "rent"),
    possession: factValue(facts, "possession"),
    visitTime: visit ? formatIst(visit.slot) : null,
    repName: lead.assignedTo ? reps.find((r) => r.id === lead.assignedTo)?.name ?? null : null,
    bookingLink: want.booking ? await mintLink("book", lead.id) : null,
    visitLink: want.visit && visitId ? await mintLink("visit", lead.id, visitId) : null,
    feedbackLink: want.feedback && visitId ? await mintLink("feedback", lead.id, visitId) : null,
    carpetArea: property && carpetSqft(property) ? `${carpetSqft(property)!.toLocaleString("en-IN")} sq ft carpet area` : null,
    rentalYield: typeof property?.rentalYieldPct === "number" ? `${property.rentalYieldPct}% a year (a platform estimate from listed rents, not a promise)` : null,
    amenities: factValue(facts, "amenities"),
    community: property?.gatedCommunity ? "a gated community" : null,
  };
  return renderTemplate(template, vars);
}

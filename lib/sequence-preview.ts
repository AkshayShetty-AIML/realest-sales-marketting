import { renderTemplate, type TemplateVars } from "./automation/templates";

/**
 * REP-FACING PREVIEW of a sequence message: the template rendered with
 * EXAMPLE values ("Hi Meera, …"), so no {{merge_field}} ever shows outside
 * the editor. Links render as a labelled placeholder. Pure; display only —
 * real sends still fill variables from the real lead (lib/automation/vars.ts).
 */
const LINK = "\u0001";
export const EXAMPLE_VARS: TemplateVars = {
  firstName: "Meera",
  property: "Cedar Heights",
  locality: "Hebbal, Bengaluru",
  price: "₹1.15 Cr",
  pricePerSqft: "₹7,419/sqft",
  rent: null,
  possession: "under construction (48% built)",
  visitTime: "Mon 5 Oct, 11:00 am",
  repName: "Priya",
  bookingLink: `${LINK}booking link${LINK}`,
  visitLink: `${LINK}visit link${LINK}`,
  feedbackLink: `${LINK}feedback form${LINK}`,
  carpetArea: "1,240 sq ft carpet area",
  rentalYield: "3.3% a year (a platform estimate from listed rents, not a promise)",
  // Cedar Heights is not gated and its amenities are all still planned — so,
  // like a real send for it, the preview shows the templates' fallbacks.
  amenities: null,
  community: null,
};

export interface PreviewPart {
  text: string;
  link: boolean;
}

export function previewParts(template: string): PreviewPart[] {
  return renderTemplate(template, EXAMPLE_VARS)
    .split(LINK)
    .map((text, i) => ({ text, link: i % 2 === 1 }))
    .filter((p) => p.text);
}

export const previewText = (template: string) => previewParts(template).map((p) => p.text).join("");

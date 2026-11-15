/**
 * MESSAGE TEMPLATES for sequence steps and scheduled messages. Reps write
 * the words; the desk fills variables from REAL data only (the lead, its
 * property's facts, the visit, freshly minted links). A variable with no
 * value uses its fallback ({{price|our current price}}) or disappears — the
 * desk never invents a value. Pure.
 */

export const TEMPLATE_VARIABLES = [
  { name: "firstName", hint: "Buyer's first name (from the masked contact)" },
  { name: "property", hint: "Property name" },
  { name: "locality", hint: "Locality, city" },
  { name: "price", hint: "Asking price (sale listings only)" },
  { name: "pricePerSqft", hint: "Price per sq ft (sale listings only)" },
  { name: "rent", hint: "Monthly rent (rental listings only)" },
  { name: "possession", hint: "Possession status" },
  { name: "visitTime", hint: "The booked visit time, IST" },
  { name: "bookingLink", hint: "Self-booking link (minted per message)" },
  { name: "visitLink", hint: "Manage / reschedule / check-in link for the visit" },
  { name: "feedbackLink", hint: "Post-visit feedback form link" },
  { name: "repName", hint: "Assigned rep's name" },
  { name: "carpetArea", hint: "Carpet area (sq ft), from the verified record" },
  { name: "rentalYield", hint: "Estimated rental yield — labelled a platform estimate" },
  { name: "amenities", hint: "Built amenities (not planned ones)" },
  { name: "community", hint: "\"a gated community\" when the record says so" },
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number]["name"], string | null>>;

const TOKEN = /\{\{\s*([a-zA-Z]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return Array.from(new Set(Array.from(template.matchAll(TOKEN), (m) => m[1])));
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(TOKEN, (_, name: string, fallback?: string) => {
      const value = vars[name as keyof TemplateVars];
      return value ? value : (fallback ?? "").trim();
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/** Which link variables a template needs, so links are only minted when used. */
export function neededLinks(template: string): { booking: boolean; visit: boolean; feedback: boolean } {
  const vars = templateVariables(template);
  return { booking: vars.includes("bookingLink"), visit: vars.includes("visitLink"), feedback: vars.includes("feedbackLink") };
}

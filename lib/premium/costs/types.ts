/**
 * The listing fields premium's cost rules read (premium lib/types.ts Property,
 * narrowed) and its provenance reader (premium lib/field-state.ts, verbatim).
 */

export type FieldStatus = "owner_stated" | "document_verified" | "computed" | "estimate" | "pending" | "to_confirm" | "assumed" | "sample";

export interface FieldState {
  status: FieldStatus;
  source: string | null;
  confidence: "high" | "medium" | "low" | null;
  note?: string;
}

export interface Property {
  possession: string;
  propertyType: string;
  priceNum: number | null;
  tco: { parking: number | null; clubhouse: number | null; gst: number | null };
  tcoExtras?: { label: string; amount: number | null }[];
  fieldStatus?: Record<string, FieldState>;
}

export function valueAt(property: Property, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), property);
}

export function fieldState(property: Property, key: string): FieldState {
  const explicit = property.fieldStatus?.[key];
  if (explicit) return explicit;
  const value = valueAt(property, key);
  if (value === null || value === undefined) return { status: "pending", source: null, confidence: null };
  return { status: "owner_stated", source: null, confidence: null };
}

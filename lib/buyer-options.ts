import type { Objection } from "./store/types";

/** Shared by the feedback form (client) and its server action. Pure. */
export const OBJECTIONS: { value: Objection; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "location", label: "Location / commute" },
  { value: "size_layout", label: "Size or layout" },
  { value: "possession", label: "Possession timeline" },
  { value: "amenities", label: "Amenities" },
  { value: "other", label: "Something else" },
];

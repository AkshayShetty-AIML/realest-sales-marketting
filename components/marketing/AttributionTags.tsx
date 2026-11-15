import { Badge } from "@/components/ui/Badge";
import { ARCHETYPE_LABEL, type Attribution } from "@/lib/premium/marketing-contract";

/** Campaign / source / archetype tags on a lead — the marketing side of the one shared lead. */
export function AttributionTags({ a }: { a: Attribution | null }) {
  if (!a || (!a.campaignName && !a.source && !a.archetype)) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {a.campaignName && <Badge tone="brand" dot={false} title={`campaign_id ${a.campaignId}`}>Campaign: {a.campaignName}</Badge>}
      {a.source && <Badge tone="outline" dot={false}>Source: {a.source.replace(/_/g, " ")}{a.utm.source ? ` · ${a.utm.source}` : ""}</Badge>}
      {a.archetype && <Badge tone="caution" dot={false} title={a.archetypeReason ?? undefined}>{ARCHETYPE_LABEL[a.archetype]}</Badge>}
    </span>
  );
}

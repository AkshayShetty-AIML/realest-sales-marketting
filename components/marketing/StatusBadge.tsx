import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { PublishStatus } from "@/lib/premium/marketing-contract";
import { STATUS_WORD } from "@/lib/marketing/labels";

const TONE: Record<PublishStatus, BadgeTone> = { draft: "neutral", submitted: "caution", approved: "brand", scheduled: "outline", published: "good" };

/** Where something is in the approval flow, in plain words (Draft → Waiting for approval → Approved → Scheduled → Live). */
export function StatusBadge({ status }: { status: PublishStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_WORD[status]}</Badge>;
}

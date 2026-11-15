import { Card, Stat } from "@/components/ui/Card";

/** lib/automation/response-time.ts → replyStats(), computed by the page. */
interface ReplyStats {
  leads: number;
  replied: number;
  medianMs: number | null;
  under90Share: number | null;
  waiting: number;
}

const secs = (ms: number | null) => (ms === null ? "—" : ms < 90_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${(ms / 60_000).toFixed(1)} min`);
const pct = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);

/** Time from a lead's arrival to the first reply it got — median and the share answered within 90 seconds. */
export function FirstReplyStats({ stats, scope }: { stats: ReplyStats; scope: string }) {
  return (
    <Card className="mt-4" title="First reply to new enquiries" eyebrow={`From the moment ${scope} arrived to the first message they got, whoever sent it`}>
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Median time to first reply" value={secs(stats.medianMs)} tone="brand" />
        <Stat label="Answered within 90 seconds" value={pct(stats.under90Share)} tone={stats.under90Share !== null && stats.under90Share < 0.8 ? "caution" : "ink"} />
        <Stat label="New enquiries measured" value={stats.leads} hint={`${stats.replied} answered`} />
        <Stat label="Still waiting for a reply" value={stats.waiting} tone={stats.waiting ? "caution" : "ink"} />
      </div>
    </Card>
  );
}

import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import { navCounts } from "@/lib/inbox-data";
import { STAGE_LABEL } from "@/lib/premium/contract";
import { formatIst, istDayKey } from "@/lib/scheduling/time";
import { AppShell } from "@/app/_shell/AppShell";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Card, Stat } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BarList } from "@/components/charts/BarList";
import { AlertIcon, BuildingIcon, CalendarIcon, ClockIcon, FlameIcon, UsersIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
function minutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1).replace(/\.0$/, "")} h`;
  return `${(m / 1440).toFixed(1).replace(/\.0$/, "")} days`;
}
function greeting(now: Date): string {
  const h = (now.getUTCHours() + 5.5) % 24; // IST
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const DOT = { good: "bg-forest", caution: "bg-ochre", risk: "bg-rust" } as const;

/** DASHBOARD — the executive summary on one screen: KPIs, two charts, what's next, what just happened. */
export default async function DashboardPage() {
  const rep = await requireRep();
  const [d, counts] = await Promise.all([loadDashboard(), navCounts()]);
  const now = new Date(d.generatedAt);
  const first = rep.name.split(/\s+/)[0];
  const inquiries = d.funnel[0]?.count ?? 0;
  const today = istDayKey(now);
  const tomorrow = istDayKey(new Date(now.getTime() + 86_400_000));
  const dayChip = (slot: string) => {
    const k = istDayKey(new Date(slot));
    return k === today ? <Badge tone="good" dot={false}>Today</Badge> : k === tomorrow ? <Badge tone="caution" dot={false}>Tomorrow</Badge> : <Badge tone="neutral" dot={false}>{formatIst(slot, "day").replace(/,.*$/, "")}</Badge>;
  };

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} fit>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[34px] leading-[1.15] text-ink">{greeting(now)}, {first}</h1>
          <p className="mt-0.5 text-[14px] text-body">Here&apos;s what&apos;s happening with your leads today.</p>
        </div>
        <p className="pt-2 text-[13px] text-muted">{now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</p>
      </div>
      {d.error && <ErrorPanel message={d.error} />}
      {d.partial > 0 && (
        <p role="status" className="mb-3 rounded-[10px] bg-trust-caution-bg px-4 py-2 text-[13px] text-trust-caution">
          {d.partial} lead{d.partial === 1 ? "" : "s"} couldn&apos;t be loaded just now, so some numbers are low. Refresh in a few seconds.
        </p>
      )}

      <div className="grid grid-cols-6 gap-3">
        <Stat icon={<UsersIcon size={19} />} value={d.leads.open} label="Open leads" />
        <Stat icon={<FlameIcon size={19} />} value={d.scores.hot} label="Hot leads" />
        <Stat icon={<CalendarIcon size={19} />} value={d.visits.booked} label="Visits booked" />
        <Stat icon={<AlertIcon size={19} />} value={pct(d.visits.noShowRate)} label="No-show rate" tone={d.visits.noShowRate && d.visits.noShowRate > 0.2 ? "caution" : "ink"} />
        <Stat icon={<ClockIcon size={19} />} value={minutes(d.response.medianMin)} label="First reply" />
        <Stat icon={<BuildingIcon size={19} />} value={`${d.inventory.available}/${d.inventory.rows.length}`} label="Units available" tone={d.inventory.stale ? "caution" : "ink"} />
      </div>

      <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <Card title="Leads by stage" action={<Link href="/pipeline" className="text-[13px] font-semibold text-brand hover:underline">Pipeline</Link>} bodyClassName="px-5 py-3">
          <BarList dense caption="Open leads by stage" labelWidth="7.5rem" data={d.pipeline.map((p) => ({ label: STAGE_LABEL[p.stage], value: p.count, detail: d.leads.open ? `${Math.round((p.count / d.leads.open) * 100)}% of open leads` : undefined }))} />
        </Card>
        <Card title="Conversion funnel" action={<span className="text-[12px] text-muted">{pct(inquiries ? d.leads.won / inquiries : null)} won</span>} bodyClassName="px-5 py-3">
          <BarList
            dense
            caption="Conversion funnel"
            labelWidth="7.5rem"
            data={d.funnel.filter((f) => f.label !== "Won").map((f) => ({ label: f.label, value: f.count, detail: inquiries ? `${Math.round((f.count / inquiries) * 100)}% of inquiries` : undefined }))}
          />
        </Card>

        <Card title="Upcoming visits" action={<Link href="/visits" className="text-[13px] font-semibold text-brand hover:underline">View all</Link>} className="flex min-h-0 flex-col" bodyClassName="min-h-0 flex-1 overflow-hidden px-5 py-1">
          <ul className="divide-y divide-line">
            {d.upcoming.slice(0, 3).map((v) => (
              <li key={v.visitId}>
                <Link href={`/leads/${encodeURIComponent(v.leadId)}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 py-2.5 hover:text-brand">
                  <span className="font-tabular text-[13px] text-ink">{formatIst(v.slot, "time")}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-ink">{v.property}</span>
                    <span className="block truncate text-[12px] text-muted">{v.buyer} · booked by {v.bookedBy === "rep" ? "a rep" : "the buyer"}</span>
                  </span>
                  {dayChip(v.slot)}
                </Link>
              </li>
            ))}
            {d.upcoming.length === 0 && <li className="py-6 text-center text-[13px] text-muted">No visits booked yet.</li>}
          </ul>
        </Card>
        <Card title="Recent activity" action={<Link href="/inbox" className="text-[13px] font-semibold text-brand hover:underline">View all</Link>} className="flex min-h-0 flex-col" bodyClassName="min-h-0 flex-1 overflow-hidden px-5 py-2">
          <ol className="relative space-y-2.5 border-l border-line pl-4">
            {d.activity.slice(0, 4).map((a) => (
              <li key={a.id} className="relative">
                <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${DOT[a.tone]}`} />
                <p className="truncate text-[13px] text-ink">
                  {a.leadId ? <Link href={`/leads/${encodeURIComponent(a.leadId)}`} className="font-medium hover:text-brand">{a.title}</Link> : <span className="font-medium">{a.title}</span>}
                  <span className="text-muted"> · {formatIst(a.at, "time")}</span>
                </p>
                {a.detail && <p className="truncate text-[12px] text-muted">{a.detail}</p>}
              </li>
            ))}
            {d.activity.length === 0 && <li className="py-4 text-[13px] text-muted">Nothing yet today.</li>}
          </ol>
        </Card>
      </div>
    </AppShell>
  );
}

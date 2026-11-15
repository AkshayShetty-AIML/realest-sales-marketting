import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { store } from "@/lib/store";
import { loadInbox } from "@/lib/inbox-data";
import { formatIst, istDayKey } from "@/lib/scheduling/time";
import { formatDistance } from "@/lib/scheduling/geo";
import type { VisitRecord } from "@/lib/store/types";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

const TONE = { scheduled: "brand", confirmed: "good", completed: "good", cancelled: "neutral", no_show: "risk" } as const;
const LABEL = { scheduled: "Booked", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" } as const;
const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "no-shows", label: "No-shows" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** VISITS — booked visits by day; reminders, check-ins and no-show recovery run on their own. */
export default async function VisitsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const rep = await requireRep();
  const requested = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : "upcoming";
  const [visits, checkIns, feedback, inbox] = await Promise.all([store().listVisits(), store().listCheckIns(), store().listFeedback(), loadInbox()]);
  const leadBy = new Map(inbox.rows.map((r) => [r.lead.id, r.lead]));
  const today = istDayKey(new Date());
  const lists: Record<Tab, VisitRecord[]> = {
    upcoming: visits.filter((v) => (v.status === "scheduled" || v.status === "confirmed") && istDayKey(new Date(v.slot)) >= today).sort((a, b) => a.slot.localeCompare(b.slot)),
    completed: visits.filter((v) => v.status === "completed").sort((a, b) => b.slot.localeCompare(a.slot)),
    "no-shows": visits.filter((v) => v.status === "no_show").sort((a, b) => b.slot.localeCompare(a.slot)),
  };
  const shown = lists[tab];
  const byDay = new Map<string, VisitRecord[]>();
  for (const v of shown) byDay.set(istDayKey(new Date(v.slot)), [...(byDay.get(istDayKey(new Date(v.slot))) ?? []), v]);

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={inbox.counts}>
      <PageHeader title="Visits" description="All booked site visits. Reminders, check-ins and no-show follow-ups happen automatically." />
      <section className="card overflow-hidden">
        <nav aria-label="Visit lists" className="flex gap-1.5 border-b border-line px-5 py-3.5">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Link key={t.key} href={t.key === "upcoming" ? "/visits" : `/visits?tab=${t.key}`} aria-current={active ? "page" : undefined}
                className={`inline-flex h-9 items-center gap-2 rounded-[9px] px-3.5 text-[13px] font-medium ${active ? "bg-brand text-white shadow-control" : "text-body hover:bg-surface-alt hover:text-ink"}`}>
                {t.label}
                <span className={`rounded-full px-1.5 font-tabular text-[11px] ${active ? "bg-white/20" : "bg-surface-alt text-muted"}`}>{lists[t.key].length}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-2">
          {byDay.size === 0 && <p className="py-10 text-center text-[14px] text-muted">{tab === "upcoming" ? "No visits booked yet. Send a buyer the booking link from their lead page." : "None yet."}</p>}
          {Array.from(byDay.entries()).map(([day, list]) => (
            <section key={day} className="border-b border-line py-2 last:border-0">
              <h2 className="py-1.5 text-[13px] font-semibold text-ink">{formatIst(list[0].slot, "day")}</h2>
              <ul>
                {list.map((v) => {
                  const lead = leadBy.get(v.leadId);
                  const proof = checkIns.filter((c) => c.visitId === v.visitId).at(-1);
                  const fb = feedback.find((f) => f.visitId === v.visitId);
                  return (
                    <li key={v.visitId}>
                      <Link href={`/leads/${encodeURIComponent(v.leadId)}`} className="grid grid-cols-[6rem_1fr_auto] items-center gap-4 rounded-[10px] px-2 py-2.5 hover:bg-brand-mist">
                        <span className="font-tabular text-[14px] text-ink">{formatIst(v.slot, "time")}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium text-ink">{lead?.context.property?.name ?? v.propertyId}</span>
                          <span className="block truncate text-[12px] text-muted">
                            {lead?.contact.name ?? "Buyer"} · {v.source === "rep" ? "booked by a rep" : v.source === "reschedule" ? "rescheduled by the buyer" : "booked by the buyer"}
                            {proof ? ` · checked in ${proof.onSite ? "on site" : `${formatDistance(proof.distanceM)} away`}` : ""}
                            {fb ? ` · feedback: ${fb.interest.replace("_", " ")}` : ""}
                          </span>
                        </span>
                        <Badge tone={TONE[v.status]}>{LABEL[v.status]}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>
      <p className="mt-3 text-[12px] text-muted">Visit hours for the booking page are in <Link href="/status" className="font-medium text-brand hover:underline">Settings</Link>.</p>
    </AppShell>
  );
}

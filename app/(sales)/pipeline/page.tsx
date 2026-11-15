import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { loadInbox, type InboxRow } from "@/lib/inbox-data";
import { LEAD_STAGES, STAGE_LABEL, type LeadStage } from "@/lib/premium/contract";
import { formatIst, istDayKey } from "@/lib/scheduling/time";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { ScoreChip } from "@/components/Chips";
import { ErrorPanel } from "@/components/ErrorPanel";
import { EmptyIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const COLUMN_TINT: Partial<Record<LeadStage, string>> = { visit_scheduled: "bg-col-visit", visit_done: "bg-col-visit", booking: "bg-col-booking" };
const EMPTY_HINT: Record<LeadStage, string> = {
  inquiry: "New inquiries land here.",
  qualified: "Leads move here when qualified.",
  visit_scheduled: "Leads move here when a visit is booked.",
  visit_done: "Leads move here after their visit.",
  negotiation: "Leads move here when negotiating.",
  booking: "Leads move here when booking.",
};

/** PIPELINE — a simple board by contract stage. Clean cards; open one to act on it. */
export default async function PipelinePage() {
  const rep = await requireRep();
  const { rows, error, counts } = await loadInbox({ score: true });
  const open = rows.filter((r) => r.lead.status !== "won" && r.lead.status !== "lost");
  const today = istDayKey(new Date());
  const yesterday = istDayKey(new Date(Date.parse(`${today}T12:00:00+05:30`) - 86_400_000));
  const whenShort = (iso: string) => {
    const k = istDayKey(new Date(iso));
    return k === today ? formatIst(iso, "time") : k === yesterday ? "Yesterday" : formatIst(iso, "day").replace(/^\w+, /, "");
  };
  const card = ({ lead, score }: InboxRow) => (
    <li key={lead.id}>
      <Link
        href={`/leads/${encodeURIComponent(lead.id)}`}
        className="block rounded-[10px] border border-line bg-white px-3 py-2.5 shadow-control transition-shadow hover:border-brand/30 hover:shadow-[var(--shadow-lift)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <p className="truncate text-[14px] font-medium text-ink">{lead.contact.name ?? "Buyer"}</p>
        <p className="truncate text-[12px] text-muted">{lead.context.property?.name ?? lead.propertyId}{lead.context.property?.config ? ` · ${lead.context.property.config}` : ""}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          {score ? <ScoreChip band={score.band} score={score.score} size="sm" /> : <span />}
          <span className="text-[11px] text-muted">{whenShort(lead.context.lastMessageAt ?? lead.createdAt)}</span>
        </div>
      </Link>
    </li>
  );

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} wide>
      <PageHeader title="Pipeline" description="Open leads by stage. Open a card to work the lead — stages move on their own as buyers book and visit." />
      {error && <ErrorPanel message={error} />}
      <div className="grid grid-cols-6 items-start gap-3">
        {LEAD_STAGES.map((stage) => {
          const column = open.filter((r) => r.lead.stage === stage);
          return (
            <section key={stage} aria-label={STAGE_LABEL[stage]} className={`flex min-h-[520px] flex-col rounded-[14px] border border-line ${COLUMN_TINT[stage] ?? "bg-surface-alt"}`}>
              <h2 className="flex items-center justify-between px-3.5 py-3 text-[14px] font-semibold text-ink">
                {STAGE_LABEL[stage]}
                <span className="font-tabular text-[13px] font-medium text-muted">{column.length}</span>
              </h2>
              {column.length ? (
                <ul className="flex flex-col gap-2 px-2.5 pb-2.5">{column.map(card)}</ul>
              ) : (
                <div className="mx-2.5 mb-2.5 flex flex-1 flex-col items-center justify-center rounded-[10px] border border-dashed border-line-strong px-3 py-10 text-center">
                  <EmptyIcon size={22} className="text-muted" />
                  <p className="mt-2 text-[13px] font-medium text-body">No leads</p>
                  <p className="mt-0.5 text-[12px] text-muted">{EMPTY_HINT[stage]}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}

import Link from "next/link";
import { AttributionTags } from "@/components/marketing/AttributionTags";
import { requireRep } from "@/lib/auth";
import { loadInbox, type InboxRow } from "@/lib/inbox-data";
import { LEAD_STAGES, STAGE_LABEL, type LeadStage } from "@/lib/premium/contract";
import { istDayKey, formatIst } from "@/lib/scheduling/time";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { ScoreCircle, StageChip } from "@/components/Chips";
import { ErrorPanel } from "@/components/ErrorPanel";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Select } from "@/components/ui/Field";
import { FilterIcon, SearchIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "all", label: "All" },
  { key: "hot", label: "Hot" },
  { key: "new", label: "New" },
  { key: "needs-rep", label: "Needs a rep" },
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "Mine" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const ASKED: Record<string, string> = { visit: "Site visit", price: "Price", availability: "Availability", callback: "Call back", general: "General" };
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function inView(row: InboxRow, view: View, repId: string): boolean {
  if (view === "hot") return row.score?.band === "hot";
  if (view === "new") return row.lead.status === "new";
  if (view === "needs-rep") return row.needsRep;
  if (view === "unassigned") return !row.lead.assignedTo;
  if (view === "mine") return row.lead.assignedTo === repId;
  return true;
}

/** What last happened, in a rep's words. */
function lastEvent(row: InboxRow): string {
  if (row.needsRep) return "Needs a rep";
  if (row.mode === "human") return "You're replying";
  if (row.lead.status === "new") return "New lead";
  if (row.autoReply?.outcome === "sent") return "AI replied";
  return `${row.lead.context.messageCount} message${row.lead.context.messageCount === 1 ? "" : "s"}`;
}

/** LEADS — every premium inquiry, ranked by lead score. A row opens the two-pane lead page. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const rep = await requireRep();
  const params = await searchParams;
  const { rows, reps, error, counts } = await loadInbox({ score: true });
  const view: View = VIEWS.some((v) => v.key === params.view) ? (params.view as View) : "all";
  const stage = LEAD_STAGES.includes(params.stage as LeadStage) ? (params.stage as LeadStage) : null;
  const owner = params.owner && reps.some((r) => r.id === params.owner) ? params.owner : null;
  const q = (params.q ?? "").trim().slice(0, 80);
  const needle = q.toLowerCase();
  const shown = rows.filter(
    (r) =>
      inView(r, view, rep.repId) &&
      (!stage || r.lead.stage === stage) &&
      (!owner || r.lead.assignedTo === owner) &&
      (!needle || [r.lead.contact.name, r.lead.context.property?.name, r.lead.context.property?.locality, r.lead.contact.phone].some((v) => v?.toLowerCase().includes(needle))),
  );
  const href = (patch: Record<string, string | null>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, stage, owner, q: q || null, ...patch })) if (v && !(k === "view" && v === "all")) qs.set(k, v);
    const s = qs.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };
  const today = istDayKey(new Date());
  const yesterday = istDayKey(new Date(Date.parse(`${today}T12:00:00+05:30`) - 86_400_000));
  const whenShort = (iso: string) => {
    const k = istDayKey(new Date(iso));
    return k === today ? formatIst(iso, "time") : k === yesterday ? "Yesterday" : formatIst(iso, "day").replace(/^\w+, /, "");
  };

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts}>
      <PageHeader title="Leads" description="All incoming buyer inquiries from the premium app, hottest first." actions={<LiveRefresh />} />

      {error ? (
        <ErrorPanel message={error} />
      ) : (
        <section className="card overflow-hidden">
          <div className="space-y-3 border-b border-line px-5 py-4">
            <nav aria-label="Views" className="flex flex-wrap gap-1.5">
              {VIEWS.map((v) => {
                const n = rows.filter((r) => inView(r, v.key, rep.repId)).length;
                const active = view === v.key;
                return (
                  <Link
                    key={v.key}
                    href={href({ view: v.key })}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-9 items-center gap-2 rounded-[9px] px-3.5 text-[13px] font-medium transition-colors ${active ? "bg-brand text-white shadow-control" : "text-body hover:bg-surface-alt hover:text-ink"}`}
                  >
                    {v.label}
                    <span className={`rounded-full px-1.5 font-tabular text-[11px] ${active ? "bg-white/20" : v.key === "hot" && n ? "bg-trust-risk-bg text-rust" : "bg-surface-alt text-muted"}`}>{n}</span>
                  </Link>
                );
              })}
            </nav>
            <form action="/inbox" className="flex items-center gap-2">
              {view !== "all" && <input type="hidden" name="view" value={view} />}
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search</span>
                <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input name="q" defaultValue={q} placeholder="Search by name, property or area…" className="control !pl-9 !bg-surface-alt/60" />
              </label>
              <Select name="stage" defaultValue={stage ?? ""} aria-label="Stage" className="!w-44">
                <option value="">All stages</option>
                {LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </Select>
              <Select name="owner" defaultValue={owner ?? ""} aria-label="Owner" className="!w-44">
                <option value="">All reps</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <button type="submit" aria-label="Apply filters" title="Apply filters" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-white text-body shadow-control hover:text-ink">
                <FilterIcon size={17} />
              </button>
            </form>
            {(stage || owner || q) && <Link href={href({ stage: null, owner: null, q: null })} className="inline-block text-[13px] font-medium text-brand hover:underline">Clear filters</Link>}
          </div>

          <div className="overflow-x-auto">
            <table className="data-table min-w-[960px]">
              <thead>
                <tr>
                  <th scope="col" className="w-[72px]">Score</th>
                  <th scope="col">Buyer</th>
                  <th scope="col">Property</th>
                  <th scope="col">Asked about</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">Owner</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const { lead } = row;
                  const name = row.rep?.name ?? lead.assignedTo;
                  const p = lead.context.property;
                  return (
                    <tr key={lead.id}>
                      <td>{row.score ? <ScoreCircle band={row.score.band} score={row.score.score} /> : <span className="text-muted">—</span>}</td>
                      <td>
                        <Link href={`/leads/${encodeURIComponent(lead.id)}`} className="row-link font-medium text-ink">{lead.contact.name ?? "Buyer"}</Link>
                        <div className="text-[12px] text-muted font-tabular">{lead.contact.phone ?? "No phone shared"}</div>
                        <AttributionTags a={row.attribution} />
                      </td>
                      <td>
                        <div className="whitespace-nowrap text-ink">{p?.name ?? lead.propertyId}</div>
                        <div className="whitespace-nowrap text-[12px] text-muted">{p ? `${p.locality} · ${p.config ?? p.propertyType}` : ""}</div>
                      </td>
                      <td className="max-w-[220px]">
                        <div className="text-ink">{ASKED[lead.kind] ?? lead.kind}</div>
                        <div className="truncate text-[12px] text-muted" title={lead.message}>{lead.message}</div>
                      </td>
                      <td><StageChip stage={lead.stage} /></td>
                      <td className="whitespace-nowrap">
                        <div className="text-ink">{whenShort(lead.context.lastMessageAt ?? lead.createdAt)}</div>
                        <div className={`text-[12px] ${row.needsRep ? "font-medium text-ochre-ink" : "text-muted"}`}>{lastEvent(row)}</div>
                      </td>
                      <td>
                        {name ? (
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mint text-[11px] font-semibold text-forest">{initials(name)}</span>
                            <span className="text-[13px] text-ink">{name.split(" ")[0]} {name.split(" ")[1]?.[0] ? `${name.split(" ")[1][0]}.` : ""}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-[13px] font-medium text-rust"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-trust-risk-bg text-[11px]">?</span>Unassigned</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={7} className="py-14 text-center text-ink">{rows.length === 0 ? "No leads yet — new inquiries appear here automatically." : "No leads match."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}

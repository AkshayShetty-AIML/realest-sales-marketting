import type { MemoryItem } from "@/lib/marketing/console/read";
import { Marker } from "./Parts";

/**
 * What a task PRODUCED, rendered from the company-memory items it wrote
 * (drafts, landing pages, calendars, sequences, the dry-run outbox, reports).
 * Display only; anything unknown is shown as its data.
 */
const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v));

function Copy({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-[8px] bg-surface-alt/60 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
      {text.split("\n").map((l, i) => <span key={i} className={`block ${/^RERA Reg\. No\.:/.test(l) ? "mt-1 font-semibold text-brand" : ""}`}>{l || " "}</span>)}
    </div>
  );
}

export function FileView({ item }: { item: MemoryItem }) {
  const d = item.data;
  let body: React.ReactNode;
  switch (item.kind) {
    case "content_draft":
      body = <><Copy text={str(d.body)} /><div className="mt-2 flex flex-wrap gap-1.5"><Marker tone="dry">{str(d.aiLabel)}</Marker><Marker tone="neutral">{str(d.type).replace(/_/g, " ")} · {str(d.channel)}</Marker><Marker tone="neutral">Draft — not published</Marker>{d.fallbackReason ? <Marker tone="neutral" title={str(d.fallbackReason)}>template fallback</Marker> : null}</div></>;
      break;
    case "landing_draft":
      body = <><p className="text-[15px] font-semibold text-ink">{str(d.headline)}</p><p className="text-[13px] text-body">{str(d.subhead)}</p><p className="mt-1 text-[12px] font-semibold text-brand">RERA Reg. No.: {str(d.reraRegNo)}</p><div className="mt-2 flex gap-1.5"><Marker tone="dry">{str(d.aiLabel)}</Marker><Marker tone="neutral">/{str(d.slug)} · draft</Marker></div></>;
      break;
    case "calendar":
      body = <ul className="space-y-1 text-[13px]">{(Array.isArray(d.slots) ? d.slots : []).map((s: { at: string; channel: string; title: string }, i: number) => <li key={i} className="flex gap-3"><span className="w-36 shrink-0 font-tabular text-muted">{new Date(s.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span><span className="w-20 shrink-0 capitalize text-body">{s.channel}</span><span className="truncate text-ink">{s.title}</span></li>)}</ul>;
      break;
    case "outbox":
      body = <>{(Array.isArray(d.ships) ? d.ships : []).map((s: { text: string }, i: number) => <Copy key={i} text={s.text} />)}<div className="mt-2 flex gap-1.5">{d.sent === true ? <Marker tone="neutral">Delivered in-app · sent:true</Marker> : <Marker tone="dry">{d.mode === "no_recipient" ? "Not sent · no recipient" : "Dry-run · Not sent (sent:false)"}</Marker>}<Marker tone="neutral">{str(d.channel)}</Marker><Marker tone="neutral">approved by {str(d.approvedBy).replace(/^operator:/, "")}</Marker></div></>;
      break;
    case "sequence_plan":
      body = <><ol className="space-y-1.5">{(Array.isArray(d.steps) ? d.steps : []).map((s: { channel: string; offsetHours: number; template: string }, i: number) => <li key={i} className="text-[12px] text-body"><span className="font-medium text-ink">{s.channel}, +{s.offsetHours}h:</span> {s.template}</li>)}</ol><div className="mt-2 flex gap-1.5"><Marker tone="neutral">Human-written · not rewritten by a model</Marker></div></>;
      break;
    case "funnel_config":
      body = <ul className="text-[12px] text-body">{(Array.isArray(d.routing) ? d.routing : []).map((r: { label: string; tag: string; sequenceId: string | null }) => <li key={r.tag}>{r.label} → <span className="font-mono">{r.tag}</span> → {r.sequenceId ?? "no sequence"}</li>)}</ul>;
      break;
    default:
      body = <pre className="max-h-48 overflow-auto rounded-[8px] bg-surface-alt/60 p-3 text-[11px] text-body">{JSON.stringify(d, null, 2)}</pre>;
  }
  return (
    <div className="rounded-[12px] border border-line bg-surface p-4">
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink"><span className="rounded-full bg-mint-light px-2 py-0.5 text-[11px] font-semibold text-brand">{item.kind.replace(/_/g, " ")}</span><span className="truncate">{item.title}</span></p>
      {body}
    </div>
  );
}

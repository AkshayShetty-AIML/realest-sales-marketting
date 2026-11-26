"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { holdUnitAction, releaseUnitAction, sellUnitAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useAction } from "@/components/lead/controls";

/** lib/allocation.ts → Grid (serialised by the page). */
interface GridUnit {
  unitId: string;
  label: string;
  tower: string;
  floor: number | null;
  status: "available" | "held" | "sold";
  indicative: boolean;
  config: string | null;
  facing: string | null;
  carpetSqft: number | null;
  price: number | null;
  hold: { by: string | null; byName: string | null; leadId: string | null; until: string | null; reason: string | null } | null;
  bookingRef: string | null;
}
interface GridData {
  towers: string[];
  floors: number[];
  units: GridUnit[];
  layoutNote: string | null;
  leads: { id: string; name: string }[];
}

const CELL: Record<GridUnit["status"], string> = {
  available: "border-trust-good-fill/40 bg-trust-good-bg text-trust-good",
  held: "border-ochre/50 bg-trust-caution-bg text-trust-caution",
  sold: "border-line bg-surface-alt text-muted",
};
const TONE: Record<GridUnit["status"], BadgeTone> = { available: "good", held: "caution", sold: "neutral" };
const word = (s: GridUnit["status"]) => s[0].toUpperCase() + s.slice(1);
const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const newKey = () => crypto.randomUUID();
const inTwoDays = () => new Date(Date.now() + 48 * 3_600_000 + 5.5 * 3_600_000).toISOString().slice(0, 16);

function Panel({ u, leads, onDone }: { u: GridUnit; leads: GridData["leads"]; onDone: () => void }) {
  const { pending, go, feedback } = useAction();
  const [leadId, setLeadId] = useState(u.hold?.leadId ?? leads[0]?.id ?? "");
  const [until, setUntil] = useState(inTwoDays);
  const [reason, setReason] = useState("");
  const [booking, setBooking] = useState("");
  const [key, setKey] = useState(newKey);
  const after = <T,>(r: T) => (setKey(newKey()), onDone(), r);
  const leadName = (id: string | null) => leads.find((l) => l.id === id)?.name ?? id;
  return (
    <aside className="card p-4" aria-label={`Unit ${u.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[17px] font-semibold text-ink">{u.label}</p>
          <p className="text-[13px] text-body">{[u.tower !== "Tower" ? `Tower ${u.tower}` : null, u.floor !== null ? `Floor ${u.floor}` : null, u.config, u.facing ? `${u.facing} facing` : null, u.carpetSqft ? `${u.carpetSqft.toLocaleString("en-IN")} sq ft carpet` : null].filter(Boolean).join(" · ") || "Details as listed"}</p>
          <p className="text-[13px] text-ink">{u.price ? rupees(u.price) : "Price not stated"}</p>
        </div>
        {u.indicative ? <Badge tone="neutral">Awaiting confirmed layout</Badge> : <Badge tone={TONE[u.status]}>{word(u.status)}</Badge>}
      </div>
      {u.indicative && <p className="mt-3 text-[13px] text-body">A layout placeholder — it can&apos;t be held or sold until the builder confirms the layout.</p>}
      {u.status === "held" && u.hold && <p className="mt-3 text-[13px] text-trust-caution">Held{u.hold.byName ? ` by ${u.hold.byName}` : ""}{u.hold.leadId ? ` for ${leadName(u.hold.leadId)}` : ""}{u.hold.until ? ` until ${ist(u.hold.until)}` : ""}{u.hold.reason ? ` — ${u.hold.reason}` : ""}.</p>}
      {u.status === "sold" && <p className="mt-3 text-[13px] text-body">Sold{u.bookingRef ? ` · booking ${u.bookingRef}` : ""}.</p>}

      {!u.indicative && u.status === "available" && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Hold for a buyer</p>
          <Field label="Buyer">
            <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              {leads.length === 0 && <option value="">No open leads on this project</option>}
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Hold until (IST, up to 30 days)"><Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          <Field label="Why (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. token cheque on Monday" /></Field>
          <Button size="sm" className="w-full" disabled={pending || !leadId || !until} onClick={() => go(() => holdUnitAction(u.unitId, leadId, new Date(`${until}:00+05:30`).toISOString(), reason, key).then(after))}>{pending ? "Holding…" : "Hold unit"}</Button>
        </div>
      )}
      {!u.indicative && u.status === "held" && (
        <div className="mt-4 border-t border-line pt-3">
          <Button size="sm" variant="secondary" className="w-full" disabled={pending} onClick={() => go(() => releaseUnitAction(u.unitId, u.hold?.leadId ?? null, reason, key).then(after))}>Release hold</Button>
        </div>
      )}
      {!u.indicative && u.status !== "sold" && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Mark sold</p>
          <Field label="Booking reference"><Input value={booking} onChange={(e) => setBooking(e.target.value)} maxLength={80} placeholder="e.g. BK-2026/0042" /></Field>
          <Button size="sm" variant="secondary" className="w-full" disabled={pending || !booking.trim()} onClick={() => go(() => sellUnitAction(u.unitId, booking.trim(), u.hold?.leadId ?? null, key).then(after))}>Mark sold</Button>
        </div>
      )}
      {feedback}
    </aside>
  );
}

export function InventoryGrid({ grid }: { grid: GridData }) {
  const router = useRouter();
  const [f, setF] = useState({ type: "", status: "", floor: "", facing: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const types = useMemo(() => Array.from(new Set(grid.units.map((u) => u.config).filter((x): x is string => Boolean(x)))).sort(), [grid.units]);
  const facings = useMemo(() => Array.from(new Set(grid.units.map((u) => u.facing).filter((x): x is string => Boolean(x)))).sort(), [grid.units]);
  const shown = (u: GridUnit) => (!f.type || u.config === f.type) && (!f.status || (f.status === "indicative" ? u.indicative : !u.indicative && u.status === f.status)) && (!f.floor || String(u.floor ?? -1) === f.floor) && (!f.facing || u.facing === f.facing);
  const current = grid.units.find((u) => u.unitId === selected) ?? null;

  if (grid.units.length === 0) return <div className="card px-6 py-14 text-center text-[15px] text-ink">No units loaded for this project yet.</div>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Select aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Any type</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option><option value="available">Available</option><option value="held">Held</option><option value="sold">Sold</option><option value="indicative">Awaiting confirmed layout</option></Select>
          <Select aria-label="Floor" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })}><option value="">Any floor</option>{grid.floors.map((fl) => <option key={fl} value={fl}>{fl < 0 ? "Floor not stated" : fl === 0 ? "Ground" : `Floor ${fl}`}</option>)}</Select>
          <Select aria-label="Facing" value={f.facing} onChange={(e) => setF({ ...f, facing: e.target.value })}><option value="">Any facing</option>{facings.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
        </div>
        {grid.layoutNote && <p className="mb-3 text-[13px] text-trust-caution">{grid.layoutNote}</p>}
        <div className="card overflow-x-auto p-3">
          <table className="border-separate border-spacing-1.5">
            <thead>
              <tr>
                <th scope="col" className="w-16 text-left text-[12px] font-medium text-muted">Floor</th>
                {grid.towers.map((t) => <th key={t} scope="col" className="text-left text-[12px] font-semibold text-ink">{t === "Tower" ? (grid.towers.length > 1 ? "No tower stated" : "") : `Tower ${t}`}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.floors.map((fl) => (
                <tr key={fl}>
                  <th scope="row" className="text-left align-top text-[12px] font-medium text-muted">{fl < 0 ? "—" : fl === 0 ? "G" : fl}</th>
                  {grid.towers.map((t) => (
                    <td key={t} className="align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {grid.units.filter((u) => u.tower === t && (u.floor ?? -1) === fl).map((u) => (
                          <button
                            key={u.unitId}
                            type="button"
                            onClick={() => setSelected(u.unitId)}
                            aria-pressed={selected === u.unitId}
                            title={`${u.label} · ${u.indicative ? "Awaiting confirmed layout" : word(u.status)}`}
                            className={`min-w-[92px] rounded-[8px] border px-2 py-1.5 text-left text-[12px] transition ${u.indicative ? "border-dashed border-line-strong bg-surface text-muted" : CELL[u.status]} ${shown(u) ? "" : "opacity-25"} ${selected === u.unitId ? "ring-2 ring-brand" : ""}`}
                          >
                            <span className="block font-semibold">{u.label}</span>
                            <span className="block">{u.indicative ? "Awaiting layout" : word(u.status)}{u.config ? ` · ${u.config}` : ""}</span>
                            {!u.indicative && (u.carpetSqft || u.price) && <span className="block text-[11px] opacity-80">{[u.carpetSqft ? `${u.carpetSqft} sq ft` : null, u.price ? `₹${(u.price / 1e5).toFixed(1)} L` : null].filter(Boolean).join(" · ")}</span>}
                          </button>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>{current ? <Panel key={`${current.unitId}:${current.status}`} u={current} leads={grid.leads} onDone={() => router.refresh()} /> : <div className="card px-4 py-8 text-center text-[13px] text-muted">Pick a unit to hold, release or mark it sold.</div>}</div>
    </div>
  );
}

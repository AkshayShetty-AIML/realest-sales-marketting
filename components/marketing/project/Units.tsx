"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { PageUnit } from "@/lib/marketing/project-page";

/**
 * UNIT SELECTION — the availability view and the enquiry form share it, so an
 * enquiry made after picking a unit is tagged with that unit (premium checks
 * it belongs to this building). Indicative units can't be picked: they are
 * layout placeholders with no facts.
 */
const Ctx = createContext<{ unit: PageUnit | null; pick: (u: PageUnit | null) => void }>({ unit: null, pick: () => undefined });
export const useSelectedUnit = () => useContext(Ctx);

export function UnitSelection({ children }: { children: ReactNode }) {
  const [unit, pick] = useState<PageUnit | null>(null);
  return <Ctx.Provider value={{ unit, pick }}>{children}</Ctx.Provider>;
}

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(n % 1e7 === 0 ? 0 : 2).replace(/\.?0+$/, "")} Cr` : `₹${(n / 1e5).toFixed(0)} L`);
const AVAIL: Record<PageUnit["availability"], { label: string; cls: string }> = {
  available: { label: "Available", cls: "pp-unit-available" },
  held: { label: "On hold", cls: "pp-unit-held" },
  sold: { label: "Sold", cls: "pp-unit-sold" },
};

/** Floor-by-floor availability, straight from the shared inventory. */
export function UnitGrid({ units, lastVerified }: { units: PageUnit[]; lastVerified: string | null }) {
  const { unit: selected, pick } = useSelectedUnit();
  const floors = Array.from(new Set(units.map((u) => u.floor))).sort((a, b) => (b ?? -1) - (a ?? -1));
  const focus = selected ?? null;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-[13px]" aria-hidden>
        {(["available", "held", "sold"] as const).map((s) => <span key={s} className="inline-flex items-center gap-2"><span className={`pp-swatch ${AVAIL[s].cls}`} />{AVAIL[s].label}</span>)}
        <span className="inline-flex items-center gap-2"><span className="pp-swatch pp-unit-indicative" />Indicative (layout placeholder)</span>
      </div>
      <div className="mt-5 space-y-2.5" role="list" aria-label="Units by floor">
        {floors.map((f) => (
          <div key={String(f)} className="grid grid-cols-[72px_1fr] items-center gap-3" role="listitem">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] opacity-60">{f === null ? "—" : `Floor ${f}`}</span>
            <div className="flex flex-wrap gap-2">
              {units.filter((u) => u.floor === f).map((u) => {
                const isSel = focus?.id === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pick(isSel ? null : u)}
                    aria-pressed={isSel}
                    aria-label={`Unit ${u.unitNo ?? u.label}: ${u.indicative ? "indicative layout placeholder" : AVAIL[u.availability].label}${u.config ? `, ${u.config}` : ""}`}
                    className={`pp-unit ${u.indicative ? "pp-unit-indicative" : AVAIL[u.availability].cls} ${isSel ? "pp-unit-selected" : ""}`}
                  >
                    <span className="block text-[14px] font-semibold">{u.unitNo ?? u.label}</span>
                    <span className="block text-[11px] opacity-80">{u.indicative ? "Indicative" : u.config && u.config !== (u.unitNo ?? u.label) ? u.config : AVAIL[u.availability].label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="pp-panel mt-5 p-5" aria-live="polite">
        {!focus ? (
          <p className="text-[14px] opacity-75">Select a unit to see its details{units.some((u) => !u.indicative && u.availability === "available") ? " and enquire about it" : ""}.</p>
        ) : focus.indicative ? (
          <div>
            <p className="text-[15px] font-semibold">Unit {focus.unitNo ?? focus.label} · indicative</p>
            <p className="mt-1 text-[13px] opacity-80">A layout placeholder while unit details are confirmed with the builder — its status is illustrative and no area, facing or price is stated for it. Enquire about the building and the team will share confirmed details.</p>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[17px] font-semibold">Unit {focus.unitNo ?? focus.label}{focus.config ? ` · ${focus.config}` : ""}</p>
              <span className={`pp-pill ${AVAIL[focus.availability].cls}`}>{AVAIL[focus.availability].label}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
              <div><dt className="opacity-60">Carpet area</dt><dd className="font-medium">{focus.carpetSqft ? `${focus.carpetSqft.toLocaleString("en-IN")} sq ft` : "Being confirmed"}</dd></div>
              <div><dt className="opacity-60">Super built-up</dt><dd className="font-medium">{focus.superBuiltUpSqft ? `${focus.superBuiltUpSqft.toLocaleString("en-IN")} sq ft` : "—"}</dd></div>
              <div><dt className="opacity-60">Facing</dt><dd className="font-medium">{focus.facing ?? "—"}{focus.facing && focus.facingNote ? <span className="opacity-60"> ({focus.facingNote})</span> : null}</dd></div>
              <div><dt className="opacity-60">Price</dt><dd className="font-medium">{focus.price ? inr(focus.price) : "On request"}</dd></div>
            </dl>
            <p className="mt-3 text-[11px] opacity-60">{focus.provenance === "verified" ? "Verified" : "As stated by the owner / builder"} · status checked {new Date(focus.lastVerifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
            {focus.availability === "available" && <a href="#enquire" className="pp-button mt-4 inline-flex">Enquire about unit {focus.unitNo ?? focus.label}</a>}
          </div>
        )}
      </div>
      {lastVerified && <p className="mt-3 text-[11px] opacity-60">Live from the inventory · last status change {new Date(lastVerified).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>}
    </div>
  );
}

/** The enquiry's unit tag (shown in the form; removable). */
export function SelectedUnitTag() {
  const { unit, pick } = useSelectedUnit();
  if (!unit || unit.indicative) return null;
  return (
    <p className="pp-panel mb-3 flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
      <span>Enquiring about <strong>unit {unit.unitNo ?? unit.label}</strong>{unit.config ? ` · ${unit.config}` : ""}</span>
      <button type="button" className="text-[12px] underline opacity-70" onClick={() => pick(null)}>Remove</button>
    </p>
  );
}

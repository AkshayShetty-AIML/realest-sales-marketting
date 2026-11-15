"use client";

import { useState } from "react";

/**
 * BAR LIST — one series over ordered or named categories (dataviz skill):
 * horizontal bars ≤ 24px, square at the baseline / 4px rounded tip, ONE hue
 * unless a bar's colour encodes an ordinal step (then the caller passes the
 * validated ramp), value at the tip in INK (text never wears the data colour),
 * per-bar hover + focus tooltip with a hit target taller than the mark, no
 * legend (the card title names the series), and an sr-only table view.
 */
export interface BarDatum {
  label: string;
  value: number;
  /** Tooltip second line, e.g. "40% of inquiries". */
  detail?: string;
  /** What's printed at the tip (defaults to the value). */
  display?: string;
  /** Validated ramp step for ordinal bars; default brand forest. */
  color?: string;
}

export function BarList({ data, caption, unit = ["lead", "leads"], labelWidth = "9.5rem", dense = false }: { data: BarDatum[]; caption: string; unit?: [string, string]; labelWidth?: string; dense?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const noun = (n: number) => (n === 1 ? unit[0] : unit[1]);
  return (
    <figure className="relative">
      <div className={dense ? "space-y-1" : "space-y-2"} role="img" aria-label={`${caption}: ${data.map((d) => `${d.label} ${d.display ?? d.value}`).join(", ")}`}>
        {data.map((d, i) => (
          <div key={d.label} className="grid items-center gap-3" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
            <span className="truncate text-right text-[13px] text-body" title={d.label}>{d.label}</span>
            <div
              className={`relative flex ${dense ? "h-[26px]" : "h-7"} items-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
              tabIndex={0}
              aria-label={`${d.label}: ${d.display ?? `${d.value} ${noun(d.value)}`}${d.detail ? `, ${d.detail}` : ""}`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive((a) => (a === i ? null : a))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-line-strong" />
              <span
                aria-hidden
                className={`${dense ? "h-[18px]" : "h-5"} rounded-r-[4px] transition-opacity ${d.color ? "" : "bg-forest"} ${active !== null && active !== i ? "opacity-50" : ""}`}
                style={{ width: d.value === 0 ? 0 : `max(4px, ${(d.value / max) * 82}%)`, backgroundColor: d.color }}
              />
              <span className="ml-2 whitespace-nowrap font-tabular text-[13px] font-semibold text-ink">{d.display ?? d.value}</span>
              {active === i && (
                <span role="tooltip" className="pointer-events-none absolute left-2 top-full z-10 mt-1 whitespace-nowrap rounded-[8px] border border-line bg-white px-3 py-2 text-[12px] shadow-[var(--shadow-lift)]">
                  <strong className="block font-tabular text-[14px] text-ink">{d.display ?? `${d.value} ${noun(d.value)}`}</strong>
                  <span className="text-muted">{d.label}{d.detail ? ` · ${d.detail}` : ""}</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">Value</th><th scope="col">Detail</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.display ?? d.value}</td><td>{d.detail ?? ""}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

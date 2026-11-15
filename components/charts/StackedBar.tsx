"use client";

import { useState } from "react";

/**
 * PART-TO-WHOLE BAR — a single 100% bar for a few parts (score bands, unit
 * status). Segments in a FIXED order with a 2px surface gap between fills,
 * 4px rounded ends, colours from a validated palette (adjacent pairs checked),
 * and identity never by colour alone: a legend with each part's label + count
 * + share is always shown, plus hover/focus tooltips and an sr-only table.
 */
export interface Part {
  label: string;
  value: number;
  color: string;
}

export function StackedBar({ parts, caption, unit = ["lead", "leads"] }: { parts: Part[]; caption: string; unit?: [string, string] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const noun = (n: number) => (n === 1 ? unit[0] : unit[1]);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <figure>
      <div className="relative flex h-6 w-full gap-[2px]" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {total === 0 && <span className="h-full w-full rounded-[4px] bg-surface-alt" />}
        {shown.map((p, i) => (
          <span
            key={p.label}
            tabIndex={0}
            aria-label={`${p.label}: ${p.value} ${noun(p.value)}, ${pct(p.value)}%`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive((a) => (a === i ? null : a))}
            onFocus={() => setActive(i)}
            onBlur={() => setActive((a) => (a === i ? null : a))}
            className={`relative h-full outline-none transition-opacity first:rounded-l-[4px] last:rounded-r-[4px] focus-visible:ring-2 focus-visible:ring-brand/40 ${active !== null && active !== i ? "opacity-50" : ""}`}
            style={{ flexGrow: p.value, flexBasis: 0, minWidth: 4, backgroundColor: p.color }}
          >
            {active === i && (
              <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-10 mt-1.5 whitespace-nowrap rounded-[8px] border border-line bg-white px-3 py-2 text-[12px] shadow-[var(--shadow-lift)]">
                <strong className="block font-tabular text-[14px] text-ink">{p.value} {noun(p.value)}</strong>
                <span className="text-muted">{p.label} · {pct(p.value)}% of {total}</span>
              </span>
            )}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-body">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: p.color }} />
            {p.label} <span className="font-tabular font-semibold text-ink">{p.value}</span>
            <span className="font-tabular text-muted">{pct(p.value)}%</span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th scope="col">Part</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead>
        <tbody>{parts.map((p) => <tr key={p.label}><td>{p.label}</td><td>{p.value}</td><td>{pct(p.value)}%</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

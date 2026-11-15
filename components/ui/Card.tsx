import type { ReactNode } from "react";

/**
 * CARD — the lifted white surface every block of content sits on, so content
 * always reads apart from the warm canvas (premium `.card`). Optional header:
 * eyebrow + Playfair title on the left, an action on the right, a hairline below.
 */
export function Card({
  title,
  eyebrow,
  action,
  children,
  className = "",
  bodyClassName = "px-5 pb-4 pt-2.5",
}: {
  title?: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || eyebrow || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pb-0.5 pt-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-tight text-ink">{title}</h2>}
            {eyebrow && <p className="mt-0.5 text-[12px] text-muted">{eyebrow}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A label/value list inside a card. "not stated" values render muted. */
export function KeyValues({ rows, dense = false }: { rows: { label: string; value: ReactNode }[]; dense?: boolean }) {
  return (
    <dl className={dense ? "" : "divide-y divide-line"}>
      {rows.map((r) => (
        <div key={r.label} className={`grid items-center gap-3 ${dense ? "grid-cols-[6.5rem_1fr] py-[3px]" : "grid-cols-[9rem_1fr] py-2 first:pt-0 last:pb-0"}`}>
          <dt className="kv-label">{r.label}</dt>
          <dd className={`kv-value ${typeof r.value === "string" && r.value.startsWith("not ") ? "!text-muted" : ""}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * STAT TILE (asset sheet → "Open leads 16"). Two recipes:
 *  - with an icon: icon well + Inter value + label (dashboard KPIs)
 *  - without: a Playfair figure in its tone + label (inventory / visits)
 */
export function Stat({
  label,
  value,
  tone = "ink",
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "ink" | "caution" | "brand" | "risk";
  icon?: ReactNode;
  hint?: ReactNode;
}) {
  const color = tone === "caution" ? "text-ochre-ink" : tone === "brand" ? "text-brand" : tone === "risk" ? "text-rust" : "text-ink";
  if (icon) {
    return (
      <div className="card flex items-center gap-3.5 px-4 py-3.5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${tone === "caution" || tone === "risk" ? "bg-trust-caution-bg text-ochre-ink" : "bg-mint-light text-brand"}`}>{icon}</span>
        <div className="min-w-0">
          <p className="font-tabular text-[22px] font-semibold leading-tight text-ink">{value}</p>
          <p className="truncate text-[13px] text-body">{label}</p>
          {hint && <p className="truncate text-[12px] text-muted">{hint}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="card px-5 py-3.5">
      <p className={`font-display text-[30px] leading-none font-tabular ${color}`}>{value}</p>
      <p className="mt-1.5 text-[13px] text-body">{label}</p>
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

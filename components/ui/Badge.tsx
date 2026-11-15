import type { ReactNode } from "react";

/**
 * STATUS BADGE — read-only state, never clickable. Deliberately unlike a
 * Button: no border-box shadow, a small leading dot, sentence case. Tones are
 * the premium trust semantics (asset sheet): good = forest, caution = ochre,
 * risk = rust; brand = forest wash; neutral = warm grey.
 */
export type BadgeTone = "good" | "caution" | "risk" | "brand" | "neutral" | "outline";

const tones: Record<BadgeTone, { box: string; dot: string }> = {
  good: { box: "bg-trust-good-bg text-trust-good", dot: "bg-forest" },
  caution: { box: "bg-trust-caution-bg text-trust-caution", dot: "bg-ochre" },
  risk: { box: "bg-trust-risk-bg text-trust-risk", dot: "bg-trust-risk-fill" },
  brand: { box: "bg-mint-light text-brand ring-1 ring-mint", dot: "bg-brand" },
  neutral: { box: "bg-surface-alt text-body", dot: "bg-muted" },
  outline: { box: "border border-line-strong bg-surface text-ink", dot: "bg-sage" },
};

export function Badge({ tone = "neutral", children, dot = true, title }: { tone?: BadgeTone; children: ReactNode; dot?: boolean; title?: string }) {
  const t = tones[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${t.box}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

/** Marks a record loaded by `npm run demo:seed` (tagged demo: true) — `npm run demo:clear` removes it. */
export function DemoBadge() {
  return <Badge tone="caution" title="Demo data — npm run demo:clear removes it">Demo</Badge>;
}

/** Uppercase tag (FOR SALE / BEST in the asset sheet) — category labels, not state. */
export function TagChip({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "neutral" }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${tone === "brand" ? "bg-brand-wash text-brand" : "bg-surface-alt text-body"}`}>
      {children}
    </span>
  );
}

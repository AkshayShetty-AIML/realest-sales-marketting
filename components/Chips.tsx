import { CHANNEL_LABEL, STAGE_LABEL, STATUS_LABEL, type Channel, type LeadStage, type LeadStatus } from "@/lib/premium/contract";
import type { Band } from "@/lib/scoring/model";
import { Badge, type BadgeTone } from "./ui/Badge";

/**
 * STATE CHIPS — the asset sheet's "Status / stage chips" and "Pipeline
 * stages". Read-only (never a button): dot + label in a soft pill. Colours
 * are tokens only (app/styles/tokens.css):
 *   score   hot = forest · warm = ochre · cold = rust
 *   stage   inquiry grey · qualified sage · visit stages mint · negotiation ochre · booking rust-wash
 */
const STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  new: "caution",
  open: "brand",
  in_progress: "brand",
  on_hold: "neutral",
  won: "good",
  lost: "risk",
};

export function StatusChip({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]} title="Lead status">{STATUS_LABEL[status]}</Badge>;
}

const STAGE_STYLE: Record<LeadStage, { box: string; dot: string }> = {
  inquiry: { box: "bg-stage-inquiry-bg text-body", dot: "bg-muted" },
  qualified: { box: "bg-stage-qualified-bg text-sage-ink", dot: "bg-sage" },
  visit_scheduled: { box: "bg-stage-visit-bg text-forest", dot: "bg-forest" },
  visit_done: { box: "bg-stage-done-bg text-forest", dot: "bg-forest" },
  negotiation: { box: "bg-stage-negotiation-bg text-ochre-ink", dot: "bg-ochre" },
  booking: { box: "bg-stage-booking-bg text-rust", dot: "bg-rust" },
};

export function StageChip({ stage, dot = true }: { stage: LeadStage; dot?: boolean }) {
  const s = STAGE_STYLE[stage];
  return (
    <span title="Pipeline stage" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${s.box}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />}
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function ChannelChip({ channel }: { channel: string }) {
  return <Badge tone="neutral" dot={false}>{CHANNEL_LABEL[channel as Channel] ?? channel}</Badge>;
}

export function AiChip({ outcome, mode }: { outcome: "sent" | "handoff" | "failed" | null; mode: "ai" | "human" }) {
  if (outcome === "failed") return <Badge tone="risk">AI reply failed</Badge>;
  if (outcome === "handoff") return <Badge tone="caution">Needs a rep</Badge>;
  if (mode === "human") return <Badge tone="outline">You&apos;re replying</Badge>;
  if (outcome === "sent") return <Badge tone="good">AI replied</Badge>;
  return <Badge tone="neutral">No reply yet</Badge>;
}

export function MaskedBadge({ masked }: { masked: boolean }) {
  return masked ? (
    <Badge tone="neutral" dot={false} title="Contact details are hidden until you reveal them">Hidden</Badge>
  ) : (
    <Badge tone="caution">Shown</Badge>
  );
}

// ─── Lead score ─────────────────────────────────────────────────────────────

export const BAND_LABEL: Record<Band, string> = { hot: "Hot", warm: "Warm", cold: "Cold", closed: "Closed" };

const BAND_PILL: Record<Band, { box: string; dot: string }> = {
  hot: { box: "bg-forest text-white", dot: "bg-white/80" },
  warm: { box: "bg-trust-caution-bg text-ochre-ink", dot: "bg-ochre" },
  cold: { box: "bg-trust-risk-bg text-rust", dot: "bg-rust" },
  closed: { box: "border border-line-strong bg-surface text-muted", dot: "bg-muted" },
};

/** Lead-score badge (pill): "● Hot 80". */
export function ScoreChip({ band, score, size = "md" }: { band: Band; score: number; size?: "sm" | "md" }) {
  const s = BAND_PILL[band];
  return (
    <span title={`Lead score ${score}/100`} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none ${size === "sm" ? "px-2 py-[3px] text-[11px]" : "px-2.5 py-1 text-[12px]"} ${s.box}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      {BAND_LABEL[band]} <span className="font-tabular">{score}</span>
    </span>
  );
}

const BAND_CIRCLE: Record<Band, string> = {
  hot: "bg-forest text-white",
  warm: "bg-trust-caution-bg text-ochre-ink ring-1 ring-ochre/30",
  cold: "bg-trust-risk-bg text-rust ring-1 ring-rust/25",
  closed: "bg-surface-alt text-muted ring-1 ring-line-strong",
};

/** Lead-score circle for list rows: the number, coloured by band (band named for screen readers). */
export function ScoreCircle({ band, score }: { band: Band; score: number }) {
  return (
    <span title={`${BAND_LABEL[band]} lead · score ${score}/100`} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-tabular text-[13px] font-semibold ${BAND_CIRCLE[band]}`}>
      {score}
      <span className="sr-only"> ({BAND_LABEL[band]})</span>
    </span>
  );
}

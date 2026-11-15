"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  assignAction,
  autoReplyAction,
  autoRouteAction,
  bookVisitAction,
  draftAction,
  handBackAction,
  moveAction,
  optInAction,
  revealContactAction,
  sendAction,
  takeOverAction,
  unitStatusAction,
  visitStatusAction,
  type ActionResult,
} from "@/app/actions";
import {
  CHANNELS,
  CHANNEL_LABEL,
  LEAD_STAGES,
  LEAD_STATUSES,
  STAGE_LABEL,
  STATUS_LABEL,
  UNIT_STATUSES,
  VISIT_TRANSITIONS,
  type Channel,
  type LeadStage,
  type LeadStatus,
  type UnitStatus,
  type VisitStatus,
} from "@/lib/premium/contract";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { EyeIcon, RouteIcon, SendIcon, SparkIcon, CalendarIcon } from "@/components/icons";

/**
 * Lead-page controls. Visual grammar (premium design system):
 *   Button primary   = the one main action in a block (forest fill)
 *   Button secondary = other actions (white, bordered)
 *   Button ghost     = low-emphasis actions
 *   Select / Input   = white wells with a border + a label above
 *   Badge            = read-only state (never clickable)
 * Every action reports back inline: green for done, rust for a problem.
 */

function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`mt-3 rounded-control border px-3 py-2 text-[13px] ${
        ok ? "border-trust-good-fill/30 bg-trust-good-bg text-trust-good" : "border-trust-risk-fill/30 bg-trust-risk-bg text-trust-risk"
      }`}
    >
      {children}
    </p>
  );
}

/** Runs a server action, keeps its pending state and its message. */
export function useAction() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const go = <T,>(action: () => Promise<ActionResult<T>>, onData?: (data: T) => void, done?: string) =>
    start(async () => {
      const result = await action();
      if (result.ok) {
        if (result.data !== undefined) onData?.(result.data);
        setMessage(result.note || done ? { ok: true, text: result.note ?? done ?? "" } : null);
      } else setMessage({ ok: false, text: result.error });
    });
  const feedback = message ? <Notice ok={message.ok}>{message.text}</Notice> : null;
  return { pending, go, feedback };
}

// ─── Header action ──────────────────────────────────────────────────────────

export function AutoReplyButton({ leadId, label }: { leadId: string; label: string }) {
  const { pending, go, feedback } = useAction();
  return (
    <div className="flex flex-col items-end">
      <Button onClick={() => go(() => autoReplyAction(leadId))} disabled={pending}>
        <SparkIcon size={16} /> {pending ? "Replying…" : label}
      </Button>
      <p className="mt-1.5 text-[12px] text-muted">Grounded on this property&apos;s data only</p>
      {feedback}
    </div>
  );
}

// ─── Pipeline + owner ───────────────────────────────────────────────────────

export function PipelineControls({
  leadId,
  stage,
  status,
  assignedTo,
  reps,
}: {
  leadId: string;
  stage: LeadStage;
  status: LeadStatus;
  assignedTo: string | null;
  reps: { id: string; name: string }[];
}) {
  const { pending, go, feedback } = useAction();
  return (
    <div className="space-y-4">
      <Field label="Stage" hint="Booking a visit moves this automatically.">
        <Select value={stage} disabled={pending} onChange={(e) => go(() => moveAction(leadId, { stage: e.target.value }), undefined, `Stage set to ${STAGE_LABEL[e.target.value as LeadStage]}.`)}>
          {LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Status">
        <Select value={status} disabled={pending} onChange={(e) => go(() => moveAction(leadId, { status: e.target.value }), undefined, `Status set to ${STATUS_LABEL[e.target.value as LeadStatus]}.`)}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Assigned rep">
        <Select
          value={assignedTo ?? ""}
          disabled={pending}
          onChange={(e) => e.target.value && go(() => assignAction(leadId, e.target.value), undefined, "Reassigned.")}
        >
          <option value="" disabled>Unassigned — pick a rep</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          {assignedTo && !reps.some((r) => r.id === assignedTo) && <option value={assignedTo}>{assignedTo}</option>}
        </Select>
      </Field>
      <Button variant="secondary" size="sm" className="w-full" disabled={pending} onClick={() => go(() => autoRouteAction(leadId))}>
        <RouteIcon size={15} /> Auto-route by area &amp; load
      </Button>
      {feedback}
    </div>
  );
}

// ─── Contact ────────────────────────────────────────────────────────────────

export function RevealContact({ leadId }: { leadId: string }) {
  const { pending, go, feedback } = useAction();
  const [contact, setContact] = useState<{ name: string | null; phone: string | null; email: string | null } | null>(null);
  if (contact) {
    return (
      <div className="rounded-control bg-trust-caution-bg px-3 py-2">
        <p className="text-[12px] text-trust-caution">Shown for contacting this buyer — this view is logged.</p>
        <p className="mt-1 font-tabular text-[13px] text-ink">{[contact.name, contact.phone, contact.email].filter(Boolean).join(" · ") || "—"}</p>
        <button type="button" className="mt-1 text-[12px] font-medium text-brand hover:underline" onClick={() => setContact(null)}>Hide again</button>
      </div>
    );
  }
  return (
    <div>
      <button type="button" disabled={pending} title="Every reveal is logged" onClick={() => go(() => revealContactAction(leadId), setContact)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brand hover:underline disabled:opacity-40">
        <EyeIcon size={14} /> Show full contact details
      </button>
      {feedback}
    </div>
  );
}

export function OptInControl({ leadId, status }: { leadId: string; status: "opted_in" | "opted_out" | null }) {
  const { pending, go, feedback } = useAction();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={pending || status === "opted_in"} onClick={() => go(() => optInAction(leadId, "opted_in"), undefined, "Opt-in recorded.")}>
          Record opt-in
        </Button>
        <Button variant="ghost" size="sm" disabled={pending || status === "opted_out"} onClick={() => go(() => optInAction(leadId, "opted_out"), undefined, "Opt-out recorded.")}>
          Record opt-out
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-muted">Only record consent the buyer actually gave you. Without it, replies go to their in-app inbox.</p>
      {feedback}
    </div>
  );
}

// ─── Conversation ───────────────────────────────────────────────────────────

const CHANNEL_HELP: Record<Channel, string> = {
  whatsapp: "Sent on WhatsApp via Twilio and logged to the premium thread.",
  in_app: "Delivered to the buyer's inbox in the premium app (max 500 characters).",
  sms: "Logged only — this desk doesn't send SMS. Production SMS needs TRAI DLT registration.",
  email: "Logged only — this desk doesn't send email yet.",
  call: "Logs a call you made. Write what was discussed.",
};

export function ModeBanner({ leadId, mode }: { leadId: string; mode: "ai" | "human" }) {
  const { pending, go, feedback } = useAction();
  return (
    <div>
      <div className={`flex items-center justify-between gap-3 rounded-control px-3 py-1.5 ${mode === "ai" ? "bg-brand-mist" : "bg-trust-caution-bg"}`}>
        <p className="min-w-0 truncate text-[12px]">
          <span className={`font-semibold ${mode === "ai" ? "text-brand" : "text-trust-caution"}`}>{mode === "ai" ? "AI is answering" : "You're handling this buyer"}</span>
          <span className="text-body"> — {mode === "ai" ? "it covers what the property data says; the rest waits for you." : "automatic messages are paused."}</span>
        </p>
        {mode === "ai" ? (
          <Button variant="secondary" size="sm" className="!h-7 shrink-0 !px-2.5 !text-[12px]" disabled={pending} onClick={() => go(() => takeOverAction(leadId))}>Take over</Button>
        ) : (
          <Button variant="secondary" size="sm" className="!h-7 shrink-0 !px-2.5 !text-[12px]" disabled={pending} onClick={() => go(() => handBackAction(leadId))}>Let AI answer</Button>
        )}
      </div>
      {feedback}
    </div>
  );
}

export interface ComposerPlan {
  configured: boolean;
  optedIn: boolean;
  to: string | null;
  problem: string | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
  templateAvailable: boolean;
  sandbox: boolean;
}

export interface Suggestion {
  body: string;
  factKeys: string[];
  humanTopics: string[];
}

function whatsappReason(plan: ComposerPlan): string | null {
  if (!plan.configured) return plan.problem ?? "WhatsApp isn't set up on this desk (Twilio credentials missing).";
  if (!plan.optedIn) return "No WhatsApp consent recorded for this buyer.";
  if (plan.problem) return plan.problem;
  if (!plan.windowOpen && !plan.templateAvailable) return "Outside the 24-hour window and no approved template is configured.";
  return null;
}

export function Composer({ leadId, plan, suggestion }: { leadId: string; plan: ComposerPlan; suggestion: Suggestion | null }) {
  const { pending, go, feedback } = useAction();
  const blocked = whatsappReason(plan);
  const [channel, setChannel] = useState<Channel>(blocked ? "in_app" : "whatsapp");
  const [body, setBody] = useState("");
  const [draftInfo, setDraftInfo] = useState<{ text: string; warn: boolean } | null>(null);
  const templateOnly = channel === "whatsapp" && !blocked && !plan.windowOpen;
  const limit = channel === "in_app" ? 500 : 1600;
  const closes = plan.windowClosesAt ? new Date(plan.windowClosesAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  const applyDraft = (text: string, keys: string[], topics: string[], engine?: string) => {
    setBody(text);
    setDraftInfo({
      text: `${engine === "llm" ? "AI" : "Grounded"} draft from the property facts (${keys.join(", ")}).${topics.length ? ` It can't answer ${topics.join(", ")} — add that yourself.` : ""} Review before sending.`,
      warn: topics.length > 0,
    });
  };

  const send = () => go(() => sendAction(leadId, channel, body.trim() || "(template)").then((r) => (r.ok && (setBody(""), setDraftInfo(null)), r)));
  return (
    <div className="space-y-2">
      {suggestion && !body && (
        <div className="flex items-start justify-between gap-3 rounded-[10px] bg-brand-mist px-3 py-2">
          <p className="min-w-0 text-[13px] text-body">
            <span className="flex items-center gap-1.5 font-semibold text-brand"><SparkIcon size={14} /> Suggested reply</span>
            <span className="line-clamp-2">{suggestion.body}</span>
            {suggestion.humanTopics.length > 0 && <span className="block text-[12px] text-trust-caution">Needs you for: {suggestion.humanTopics.join(", ")}</span>}
          </p>
          <Button variant="secondary" size="sm" className="!h-8 shrink-0" onClick={() => applyDraft(suggestion.body, suggestion.factKeys, suggestion.humanTopics)}>Use it</Button>
        </div>
      )}
      {draftInfo && <p className={`rounded-control px-3 py-1.5 text-[12px] ${draftInfo.warn ? "bg-trust-caution-bg text-trust-caution" : "bg-brand-mist text-brand"}`}>{draftInfo.text}</p>}
      {templateOnly && <p className="text-[12px] text-muted">Outside the 24-hour window — the approved WhatsApp template goes to {plan.to}, not your text.</p>}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 rounded-[12px] border border-line-strong bg-white shadow-control focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pending && (body.trim() || templateOnly)) send();
            }}
            placeholder={templateOnly ? "Optional note for the log" : `Type a message${channel === "in_app" ? "" : ` (${CHANNEL_LABEL[channel]})`}…`}
            maxLength={limit}
            rows={2}
            aria-label="Message"
            className="block max-h-40 min-h-[2.75rem] w-full resize-none rounded-[12px] bg-transparent px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted"
          />
          <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              aria-label="Send as"
              title={CHANNEL_HELP[channel]}
              className="h-7 rounded-[6px] border border-line bg-surface-alt px-2 text-[12px] text-body"
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c} disabled={c === "whatsapp" && Boolean(blocked)}>
                  {c === "in_app" ? "In-app message" : c === "whatsapp" ? (blocked ? "WhatsApp (pending setup)" : "WhatsApp") : c === "call" ? "Log a call" : `Log ${CHANNEL_LABEL[c]}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={() => go(() => draftAction(leadId), (d) => applyDraft(d.body, d.factKeys, d.humanTopics, d.engine))}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-brand hover:bg-brand-mist disabled:opacity-40"
            >
              <SparkIcon size={13} /> Answer with AI
            </button>
            <span className="ml-auto font-tabular text-[11px] text-muted">{body.length}/{limit}{closes && channel === "whatsapp" ? ` · window until ${closes}` : ""}</span>
          </div>
        </div>
        <button
          type="button"
          aria-label={templateOnly ? "Send template" : "Send"}
          title="Send (⌘↵) — sending pauses automation for this buyer"
          disabled={pending || (!body.trim() && !templateOnly)}
          onClick={send}
          className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-control transition-colors hover:bg-brand-hover disabled:opacity-40"
        >
          <SendIcon size={18} />
        </button>
      </div>
      {feedback}
    </div>
  );
}

// ─── Lead page: owner, stage, messaging preferences ─────────────────────────

/** Owner row in "About this buyer": the rep, changeable; auto-route lives in its menu. */
export function OwnerControl({ leadId, assignedTo, reps }: { leadId: string; assignedTo: string | null; reps: { id: string; name: string }[] }) {
  const { pending, go, feedback } = useAction();
  return (
    <div>
      <div className="flex items-center gap-2">
        <Select
          className="!h-8 !text-[13px]"
          value={assignedTo ?? ""}
          disabled={pending}
          aria-label="Owner"
          onChange={(e) => (e.target.value === "__auto" ? go(() => autoRouteAction(leadId)) : e.target.value && go(() => assignAction(leadId, e.target.value), undefined, "Owner changed."))}
        >
          <option value="" disabled>Unassigned — pick a rep</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          {assignedTo && !reps.some((r) => r.id === assignedTo) && <option value={assignedTo}>{assignedTo}</option>}
          <option value="__auto">Pick automatically (area &amp; workload)</option>
        </Select>
      </div>
      {feedback}
    </div>
  );
}

/** The stage moves on its own (bookings, visits, feedback); a rep can still correct it here. */
export function StageControl({ leadId, stage, status }: { leadId: string; stage: LeadStage; status: LeadStatus }) {
  const { pending, go, feedback } = useAction();
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[12px] font-medium text-brand hover:underline">Change manually</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Select className="!h-8 !text-[13px]" value={stage} disabled={pending} aria-label="Stage" onChange={(e) => go(() => moveAction(leadId, { stage: e.target.value }), undefined, `Stage set to ${STAGE_LABEL[e.target.value as LeadStage]}.`)}>
          {LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </Select>
        <Select className="!h-8 !text-[13px]" value={status} disabled={pending} aria-label="Status" onChange={(e) => go(() => moveAction(leadId, { status: e.target.value }), undefined, `Status set to ${STATUS_LABEL[e.target.value as LeadStatus]}.`)}>
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      {feedback}
    </details>
  );
}

/**
 * MESSAGING PREFERENCES — an opt-in checklist per channel (replaces the old
 * WhatsApp card). In-app is the live channel and always on. WhatsApp is bound
 * to the existing consent record (optInAction). SMS and email have no consent
 * record yet and no sender — shown as "pending setup", not tickable.
 */
export function MessagingPrefs({ leadId, whatsapp, whatsappLive }: { leadId: string; whatsapp: "opted_in" | "opted_out" | null; whatsappLive: boolean }) {
  const { pending, go, feedback } = useAction();
  const row = (label: string, checked: boolean, opts: { disabled: boolean; note: string; noteTone?: "good" | "muted" | "caution"; onChange?: (v: boolean) => void }) => (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <label className={`flex items-center gap-2.5 text-[14px] ${opts.disabled ? "text-muted" : "cursor-pointer text-ink"}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={opts.disabled || pending}
          onChange={(e) => opts.onChange?.(e.target.checked)}
          className="h-4 w-4 rounded-[4px] accent-[var(--color-forest)] disabled:opacity-60"
        />
        {label}
      </label>
      <span className={`text-[12px] ${opts.noteTone === "good" ? "text-forest" : opts.noteTone === "caution" ? "text-ochre-ink" : "text-muted"}`}>{opts.note}</span>
    </li>
  );
  return (
    <div>
      <ul className="divide-y divide-line">
        {row("In-app inbox", true, { disabled: true, note: "Live · always on", noteTone: "good" })}
        {row("WhatsApp", whatsapp === "opted_in", {
          disabled: false,
          note: `${whatsapp === "opted_in" ? "Opted in" : whatsapp === "opted_out" ? "Opted out" : "Not asked yet"}${whatsappLive ? "" : " · pending setup"}`,
          noteTone: whatsapp === "opted_in" ? "good" : whatsapp === "opted_out" ? "caution" : "muted",
          onChange: (v) => go(() => optInAction(leadId, v ? "opted_in" : "opted_out"), undefined, v ? "WhatsApp opt-in recorded." : "WhatsApp opt-out recorded."),
        })}
        {row("SMS", false, { disabled: true, note: "Pending setup" })}
        {row("Email", false, { disabled: true, note: "Pending setup" })}
      </ul>
      <p className="mt-1.5 text-[12px] text-muted">Tick only what the buyer agreed to.</p>
      {feedback}
    </div>
  );
}

// ─── Visits + inventory ─────────────────────────────────────────────────────

export function BookVisit({ leadId }: { leadId: string }) {
  const { pending, go, feedback } = useAction();
  const [slot, setSlot] = useState("");
  const [location, setLocation] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Date & time">
        <Input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} />
      </Field>
      <Field label="Meeting point (optional)">
        <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Site office, Gate 2" maxLength={200} />
      </Field>
      <Button variant="secondary" size="sm" className="w-full" disabled={pending || !slot} onClick={() => go(() => bookVisitAction(leadId, slot, location).then((r) => (r.ok && (setSlot(""), setLocation("")), r)), undefined, "Visit booked.")}>
        <CalendarIcon size={15} /> Book visit
      </Button>
      {feedback}
    </div>
  );
}

export function VisitStatus({ leadId, visitId, status }: { leadId: string; visitId: string; status: VisitStatus }) {
  const { pending, go, feedback } = useAction();
  const next = VISIT_TRANSITIONS[status];
  if (next.length === 0) return null;
  return (
    <div className="mt-2">
      <Select className="!h-9 text-[13px]" defaultValue="" disabled={pending} aria-label="Update visit" onChange={(e) => e.target.value && go(() => visitStatusAction(leadId, visitId, e.target.value))}>
        <option value="" disabled>Update visit…</option>
        {next.map((s) => <option key={s} value={s}>Mark {s.replace("_", " ")}</option>)}
      </Select>
      {feedback}
    </div>
  );
}

export function UnitStatus({ leadId, unitId, status }: { leadId: string; unitId: string; status: UnitStatus }) {
  const { pending, go, feedback } = useAction();
  return (
    <div>
      <Select className="!h-9 w-32 text-[13px]" value={status} disabled={pending} aria-label={`Status of ${unitId}`} onChange={(e) => go(() => unitStatusAction(leadId, unitId, e.target.value), undefined, "Updated and re-verified now.")}>
        {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
      </Select>
      {feedback}
    </div>
  );
}

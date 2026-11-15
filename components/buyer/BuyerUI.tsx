"use client";

import { useMemo, useState, useTransition } from "react";
import { bookAction, cancelAction, checkInAction, confirmAction, feedbackAction, rescheduleAction, type BuyerResult } from "@/app/b/actions";
import { OBJECTIONS } from "@/lib/buyer-options";
import { Button } from "@/components/ui/Button";

/**
 * Buyer-facing controls for /b/<token>: slot picker (book / reschedule),
 * visit actions (confirm, cancel, geotag check-in) and the feedback form.
 * Mobile-first, same design tokens as the desk.
 */

export interface SlotDayView {
  dayKey: string;
  weekday: string;
  dayNum: string;
  month: string;
  slots: { start: string; label: string; remaining: number }[];
}

function Result({ result }: { result: BuyerResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`mt-4 rounded-[10px] px-4 py-3 text-[14px] ${result.ok ? "bg-trust-good-bg text-trust-good" : "bg-trust-risk-bg text-trust-risk"}`}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

export function SlotPicker({ token, days, mode }: { token: string; days: SlotDayView[]; mode: "book" | "reschedule" }) {
  const [day, setDay] = useState(days[0]?.dayKey ?? "");
  const [slot, setSlot] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<BuyerResult | null>(null);
  const current = useMemo(() => days.find((d) => d.dayKey === day), [days, day]);

  if (result?.ok && result.next) {
    return (
      <div className="rounded-[14px] border border-brand/20 bg-brand-mist p-5">
        <p className="font-display text-[22px] text-ink">{result.message}</p>
        <p className="mt-2 text-[14px] text-body">We&apos;ve sent the details to your inbox in the app, with reminders before the day.</p>
        <a href={result.next} className="mt-4 inline-flex h-11 items-center rounded-control bg-brand px-5 text-[14px] font-medium text-white">Manage this visit</a>
      </div>
    );
  }
  if (days.length === 0) return <p className="rounded-[10px] bg-surface-alt p-4 text-[14px] text-body">No visit slots are open right now — reply in your inbox and we&apos;ll find a time.</p>;

  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-body">Pick a day</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="radiogroup" aria-label="Day">
        {days.map((d) => (
          <button
            key={d.dayKey}
            type="button"
            role="radio"
            aria-checked={day === d.dayKey}
            onClick={() => {
              setDay(d.dayKey);
              setSlot(null);
            }}
            className={`flex w-16 shrink-0 flex-col items-center rounded-[12px] border py-2.5 transition-colors ${day === d.dayKey ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-line-strong"}`}
          >
            <span className={`text-[11px] uppercase tracking-[0.08em] ${day === d.dayKey ? "text-white/80" : "text-muted"}`}>{d.weekday}</span>
            <span className="font-display text-[22px] leading-tight">{d.dayNum}</span>
            <span className={`text-[11px] ${day === d.dayKey ? "text-white/80" : "text-muted"}`}>{d.month}</span>
          </button>
        ))}
      </div>
      <p className="mb-2 mt-4 text-[13px] font-medium text-body">Pick a time (IST)</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Time">
        {current?.slots.map((s) => (
          <button
            key={s.start}
            type="button"
            role="radio"
            aria-checked={slot === s.start}
            onClick={() => setSlot(s.start)}
            className={`h-11 rounded-[10px] border text-[14px] font-medium transition-colors ${slot === s.start ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand/40"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Button
        className="mt-5 w-full"
        size="lg"
        disabled={!slot || pending}
        onClick={() => slot && start(async () => setResult(await (mode === "book" ? bookAction(token, slot) : rescheduleAction(token, slot))))}
      >
        {pending ? "Booking…" : mode === "book" ? "Book this visit" : "Move my visit here"}
      </Button>
      <p className="mt-2 text-center text-[12px] text-muted">Your visit is confirmed instantly. You can change it anytime from the link we send.</p>
      <Result result={result} />
    </div>
  );
}

export function VisitActions({ token, canCheckIn, status }: { token: string; canCheckIn: boolean; status: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<BuyerResult | null>(null);
  const [locating, setLocating] = useState(false);

  const checkIn = () => {
    if (!("geolocation" in navigator)) return setResult({ ok: false, error: "This device can't share its location." });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        start(async () => setResult(await checkInAction(token, pos.coords.latitude, pos.coords.longitude, Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null)));
      },
      () => {
        setLocating(false);
        setResult({ ok: false, error: "We need your location to check you in — allow it and try again." });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <div className="space-y-3">
      {canCheckIn && (
        <Button size="lg" className="w-full" disabled={pending || locating} onClick={checkIn}>
          {locating ? "Finding you…" : pending ? "Checking in…" : "I've arrived — check in"}
        </Button>
      )}
      {status === "scheduled" && (
        <Button variant="secondary" size="lg" className="w-full" disabled={pending} onClick={() => start(async () => setResult(await confirmAction(token)))}>
          I&apos;ll be there
        </Button>
      )}
      <Button
        variant="ghost"
        size="md"
        className="w-full"
        disabled={pending}
        onClick={() => {
          if (confirm("Cancel this visit?")) start(async () => setResult(await cancelAction(token)));
        }}
      >
        Cancel visit
      </Button>
      {canCheckIn && <p className="text-center text-[12px] text-muted">Check-in shares your location once, only to confirm you&apos;re at the site.</p>}
      <Result result={result} />
    </div>
  );
}

export function FeedbackForm({ token }: { token: string }) {
  const [interest, setInterest] = useState<string | null>(null);
  const [objections, setObjections] = useState<string[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<BuyerResult | null>(null);

  if (result?.ok) return <Result result={result} />;
  const options = [
    { value: "interested", label: "I'm interested", hint: "Let's talk next steps" },
    { value: "maybe", label: "Maybe", hint: "A few things are holding me back" },
    { value: "not_interested", label: "Not for me", hint: "It doesn't fit what I need" },
  ];
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold text-ink">How do you feel about it?</legend>
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-[12px] border px-4 py-3 transition-colors ${interest === o.value ? "border-brand bg-brand-mist" : "border-line bg-white hover:border-line-strong"}`}>
              <input type="radio" name="interest" value={o.value} checked={interest === o.value} onChange={() => setInterest(o.value)} className="accent-[var(--color-brand)]" />
              <span>
                <span className="block text-[15px] font-medium text-ink">{o.label}</span>
                <span className="block text-[13px] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {interest && interest !== "interested" && (
        <fieldset>
          <legend className="mb-2 text-[14px] font-semibold text-ink">What held you back? <span className="font-normal text-muted">(pick any)</span></legend>
          <div className="flex flex-wrap gap-2">
            {OBJECTIONS.map((o) => {
              const on = objections.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setObjections(on ? objections.filter((x) => x !== o.value) : [...objections, o.value])}
                  className={`rounded-full border px-4 py-2 text-[14px] font-medium transition-colors ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-line-strong"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-2 text-[14px] font-semibold text-ink">Rate the visit <span className="font-normal text-muted">(optional)</span></legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)} className={`h-11 w-11 rounded-full border text-[15px] font-semibold ${rating !== null && n <= rating ? "border-ochre bg-ochre text-ink" : "border-line bg-white text-muted"}`}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-2 block text-[14px] font-semibold text-ink">Anything else? <span className="font-normal text-muted">(optional)</span></span>
        <textarea className="control min-h-24" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
      </label>
      <Button size="lg" className="w-full" disabled={!interest || pending} onClick={() => interest && start(async () => setResult(await feedbackAction(token, { interest, objections, rating, comment })))}>
        {pending ? "Sending…" : "Send feedback"}
      </Button>
      <Result result={result} />
    </div>
  );
}

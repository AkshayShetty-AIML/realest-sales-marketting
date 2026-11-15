"use client";

import { useState, useTransition } from "react";
import { saveVisitSettingsAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import type { VisitSettings } from "@/lib/sales-types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function VisitSettingsForm({ initial }: { initial: VisitSettings }) {
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (k: keyof VisitSettings) => (e: { target: { value: string } }) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opens (IST hour)"><Input type="number" min={6} max={21} value={v.startHour} onChange={num("startHour")} /></Field>
        <Field label="Closes (IST hour)"><Input type="number" min={7} max={22} value={v.endHour} onChange={num("endHour")} /></Field>
        <Field label="Slot length">
          <Select value={v.slotMinutes} onChange={num("slotMinutes")}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</Select>
        </Field>
        <Field label="Visitors per slot"><Input type="number" min={1} max={20} value={v.capacityPerSlot} onChange={num("capacityPerSlot")} /></Field>
        <Field label="Bookable days ahead"><Input type="number" min={1} max={60} value={v.daysAhead} onChange={num("daysAhead")} /></Field>
        <Field label="Minimum notice (hours)"><Input type="number" min={0} max={72} value={v.minNoticeHours} onChange={num("minNoticeHours")} /></Field>
      </div>
      <div>
        <span className="field-label">Closed on</span>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const closed = v.closedWeekdays.includes(i);
            return (
              <button key={d} type="button" aria-pressed={closed} onClick={() => setV({ ...v, closedWeekdays: closed ? v.closedWeekdays.filter((x) => x !== i) : [...v.closedWeekdays, i] })}
                className={`h-9 w-12 rounded-[8px] border text-[13px] font-medium ${closed ? "border-trust-risk-fill/40 bg-trust-risk-bg text-trust-risk" : "border-line bg-white text-ink"}`}>
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveVisitSettingsAction(v); setMsg(r.ok ? { ok: true, text: r.note ?? "Saved." } : { ok: false, text: r.error }); })}>
        {pending ? "Saving…" : "Save visit hours"}
      </Button>
      {msg && <p role="status" className={`text-[12px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p>}
    </div>
  );
}

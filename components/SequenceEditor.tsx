"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSequenceAction, saveSequenceAction, toggleSequenceAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";
import { TEMPLATE_VARIABLES } from "@/lib/template-vars";
import { MessagePreview } from "@/components/MessagePreview";
import type { Objection, Sequence, SequenceStep, SequenceTrigger, StepChannel } from "@/lib/sales-types";

const TRIGGERS: { value: SequenceTrigger; label: string }[] = [
  { value: "inquiry_received", label: "New inquiry (after the instant reply)" },
  { value: "no_reply", label: "No reply to our last message" },
  { value: "cold_lead", label: "Cold lead (no activity)" },
  { value: "visit_booked", label: "Visit booked (times relative to the visit)" },
  { value: "visit_no_show", label: "Visit marked no-show" },
  { value: "feedback_interested", label: "Post-visit feedback: interested" },
  { value: "feedback_objection", label: "Post-visit feedback: objection" },
];
const OBJECTIONS: { value: Objection; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "location", label: "Location" },
  { value: "size_layout", label: "Size / layout" },
  { value: "possession", label: "Possession timeline" },
  { value: "amenities", label: "Amenities" },
  { value: "other", label: "Something else" },
];
const CHANNELS: { value: StepChannel; label: string }[] = [
  { value: "in_app", label: "In-app (live)" },
  { value: "whatsapp", label: "WhatsApp (pending setup)" },
  { value: "email", label: "Email (pending setup)" },
  { value: "sms", label: "SMS (pending setup)" },
];

const blank: Sequence = { id: "", name: "", trigger: "inquiry_received", params: {}, active: true, stopOnReply: true, steps: [{ offsetHours: 2, channel: "in_app", template: "" }] };

/** The sequence builder: trigger + steps (delay, channel, message). */
export function SequenceEditor({ initial }: { initial: Sequence | null }) {
  const router = useRouter();
  const [seq, setSeq] = useState<Sequence>(initial ?? blank);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const relative = seq.trigger === "visit_booked";

  const setStep = (i: number, patch: Partial<SequenceStep>) => setSeq({ ...seq, steps: seq.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const save = () =>
    start(async () => {
      const r = await saveSequenceAction({ ...seq, id: seq.id || undefined });
      if (r.ok) {
        setMsg({ ok: true, text: r.note ?? "Saved." });
        if (!seq.id && r.data) router.push(`/sequences?edit=${r.data.id}`);
        else router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name"><Input value={seq.name} onChange={(e) => setSeq({ ...seq, name: e.target.value })} placeholder="e.g. Post-inquiry follow-up" /></Field>
        <Field label="Trigger — when does it start?">
          <Select value={seq.trigger} onChange={(e) => setSeq({ ...seq, trigger: e.target.value as SequenceTrigger, params: {} })}>
            {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        {seq.trigger === "no_reply" && (
          <Field label="Start after no reply for (hours)"><Input type="number" min={1} value={seq.params.afterHours ?? 48} onChange={(e) => setSeq({ ...seq, params: { afterHours: Number(e.target.value) } })} /></Field>
        )}
        {seq.trigger === "cold_lead" && (
          <Field label="Start after no activity for (days)"><Input type="number" min={1} value={seq.params.afterDays ?? 14} onChange={(e) => setSeq({ ...seq, params: { afterDays: Number(e.target.value) } })} /></Field>
        )}
        {seq.trigger === "feedback_objection" && (
          <Field label="Objection it answers">
            <Select value={seq.params.objection ?? ""} onChange={(e) => setSeq({ ...seq, params: { objection: e.target.value as Objection } })}>
              <option value="" disabled>Choose…</option>
              {OBJECTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-6 md:col-span-2">
          <label className="flex items-center gap-2 text-[14px] text-ink"><input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={seq.active} onChange={(e) => setSeq({ ...seq, active: e.target.checked })} /> Active</label>
          <label className="flex items-center gap-2 text-[14px] text-ink"><input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={seq.stopOnReply} onChange={(e) => setSeq({ ...seq, stopOnReply: e.target.checked })} /> Stop when the buyer replies</label>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Steps</h3>
        <ol className="space-y-3">
          {seq.steps.map((step, i) => (
            <li key={i} className="rounded-[12px] border border-line bg-white p-4">
              <div className="grid gap-3 md:grid-cols-[11rem_14rem_1fr_auto] md:items-end">
                <Field label={relative ? "Hours vs visit (−24 = day before)" : "Hours after trigger"}>
                  <Input type="number" step={0.5} value={step.offsetHours} onChange={(e) => setStep(i, { offsetHours: Number(e.target.value) })} />
                </Field>
                <Field label="Channel">
                  <Select value={step.channel} onChange={(e) => setStep(i, { channel: e.target.value as StepChannel })}>
                    {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </Field>
                <p className="text-[12px] text-muted md:pb-2">
                  {step.channel === "in_app" ? "Goes to the buyer's in-app inbox." : "Saved for later — this channel isn't set up yet, so nothing is sent."}
                </p>
                <Button variant="ghost" size="sm" disabled={seq.steps.length === 1} onClick={() => setSeq({ ...seq, steps: seq.steps.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
              <TextArea className="mt-3" rows={3} value={step.template} onChange={(e) => setStep(i, { template: e.target.value })} placeholder="Hi {{firstName|there}}, …" maxLength={480} />
              <div className="mt-2 flex items-start justify-between gap-3">
                <p className="min-w-0 rounded-[10px] bg-bubble-out px-3 py-2 text-[13px] leading-relaxed text-ink">
                  <span className="mb-0.5 block text-[11px] font-medium text-sage-ink">The buyer sees (example)</span>
                  <MessagePreview template={step.template} />
                </p>
                <p className="shrink-0 font-tabular text-[11px] text-muted">{step.template.length} / 480</p>
              </div>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" className="mt-3" disabled={seq.steps.length >= 10} onClick={() => setSeq({ ...seq, steps: [...seq.steps, { offsetHours: (seq.steps.at(-1)?.offsetHours ?? 0) + 24, channel: "in_app", template: "" }] })}>
          + Add step
        </Button>
      </div>

      <details className="rounded-[10px] bg-surface-alt p-4">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink">Personalise: fields you can insert</summary>
        <ul className="mt-3 grid gap-1.5 text-[12px] text-body md:grid-cols-2">
          {TEMPLATE_VARIABLES.map((v) => <li key={v.name}><code className="rounded bg-white px-1.5 py-0.5 text-ink">{`{{${v.name}}}`}</code> — {v.hint}</li>)}
        </ul>
        <p className="mt-3 text-[12px] text-muted">Add a fallback with a bar: <code className="text-ink">{"{{firstName|there}}"}</code>. A value we don&apos;t have is never invented.</p>
      </details>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save sequence"}</Button>
        {seq.id && (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await toggleSequenceAction(seq.id, !seq.active); if (r.ok) { setSeq({ ...seq, active: !seq.active }); router.refresh(); } })}>
              {seq.active ? "Pause" : "Activate"}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => { if (confirm("Delete this sequence? Running copies are stopped.")) start(async () => { const r = await deleteSequenceAction(seq.id); if (r.ok) router.push("/sequences"); }); }}>Delete</Button>
          </>
        )}
        {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addLeadAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";

/** Project choices (lib/projects.ts, serialised by the page). */
interface ProjectChoice {
  id: string;
  name: string;
  units: { unitId: string; label: string; status: string; indicative: boolean }[];
}

const SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "call", label: "Phone call" },
  { value: "referral", label: "Referral" },
  { value: "event", label: "Event" },
  { value: "other", label: "Other" },
] as const;

/**
 * "Add lead" — a buyer met at the site office, on a call, by referral or at
 * an event. Saved to the shared leads store; if the same phone or email is
 * already a lead on this project, the existing lead opens instead. One key per
 * form, so a double click never adds the buyer twice.
 */
export function AddLeadForm({ projects }: { projects: ProjectChoice[] }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [v, setV] = useState({ name: "", phone: "", email: "", projectId: projects[0]?.id ?? "", unitId: "", source: "walk_in", notes: "", consent: false, channels: { in_app: false, email: false, whatsapp: false, sms: false } });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const project = projects.find((p) => p.id === v.projectId);
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await addLeadAction(v, key);
      if (!r.ok) return setError(r.error);
      router.push(`/leads/${encodeURIComponent(r.data!.leadId)}${r.data!.duplicate ? "?existing=1" : ""}`);
    });
  return (
    <form className="card max-w-3xl space-y-4 p-5" onSubmit={(e) => (e.preventDefault(), submit())}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input required value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} autoComplete="off" /></Field>
        <Field label="Phone"><Input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} placeholder="+91 98450 11111" autoComplete="off" /></Field>
        <Field label="Email"><Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} maxLength={254} autoComplete="off" /></Field>
      </div>
      <p className="-mt-2 text-[12px] text-muted">A phone number, an email, or both.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Project">
          <Select value={v.projectId} onChange={(e) => set({ projectId: e.target.value, unitId: "" })}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Unit (optional)">
          <Select value={v.unitId} onChange={(e) => set({ unitId: e.target.value })} disabled={!project?.units.length}>
            <option value="">{project?.units.length ? "No particular unit" : "No units loaded for this project yet"}</option>
            {project?.units.map((u) => <option key={u.unitId} value={u.unitId}>{u.label}{u.indicative ? " — awaiting confirmed layout" : u.status !== "available" ? ` — ${u.status}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="How they came to us">
          <Select value={v.source} onChange={(e) => set({ source: e.target.value })}>{SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        </Field>
      </div>
      <Field label="Notes (optional)"><TextArea rows={3} value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={500} placeholder="What they're looking for — this becomes the lead's message." /></Field>
      <fieldset className="space-y-2 rounded-[10px] border border-line p-3">
        <legend className="px-1 text-[13px] font-semibold text-ink">Consent</legend>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <input type="checkbox" className="mt-0.5" checked={v.consent} onChange={(e) => set({ consent: e.target.checked, channels: e.target.checked ? v.channels : { in_app: false, email: false, whatsapp: false, sms: false } })} />
          The buyer agreed to be contacted about this home.
        </label>
        <div className="flex flex-wrap gap-4 pl-6 text-[13px] text-body">
          {(["whatsapp", "email", "sms", "in_app"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="checkbox" disabled={!v.consent} checked={v.channels[c]} onChange={(e) => set({ channels: { ...v.channels, [c]: e.target.checked } })} />
              {c === "whatsapp" ? "WhatsApp" : c === "email" ? "Email" : c === "sms" ? "SMS" : "In the app"}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="rounded-control border border-trust-risk-fill/30 bg-trust-risk-bg px-3 py-2 text-[13px] text-trust-risk">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !v.name.trim() || !(v.phone.trim() || v.email.trim()) || !v.consent || !v.projectId}>{pending ? "Adding…" : "Add lead"}</Button>
        <p className="text-[12px] text-muted">If this person is already a lead on the project, you&apos;ll go to that lead instead.</p>
      </div>
    </form>
  );
}

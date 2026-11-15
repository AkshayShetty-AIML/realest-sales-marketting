"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { generateContentAction, generateReelAction, saveContentDraftAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TransitionControls } from "./Controls";
import { channelWord } from "@/lib/marketing/labels";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";
import type { GenType } from "@/lib/marketing/compose";

type Draft = { type: GenType; channel: string; title: string; body: string; factKeys: string[]; engine: "llm" | "template"; aiLabel: string; fallbackReason: string | null };
type Row = Draft & { original: string; saved: string | null; savedId: string | null; error: string | null };

const TYPES: { value: GenType; label: string }[] = [
  { value: "social_post", label: "Social media post" },
  { value: "caption", label: "Short caption" },
  { value: "ad_copy", label: "Ad text" },
];

export function ContentStudio({ buildings, reraRegNo, brand }: { buildings: { id: string; name: string; locality: string; city: string; available: number; units: number }[]; reraRegNo: string | null; brand: { primaryColor: string; headingFont: string; builderName: string | null } | null }) {
  const [propertyId, setPropertyId] = useState(buildings[0]?.id ?? "");
  const [types, setTypes] = useState<GenType[]>(["social_post", "caption", "ad_copy"]);
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      setMsg(null);
      const r = await generateContentAction(propertyId, types);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setWarnings(r.data?.warnings ?? []);
      setRows((r.data?.drafts ?? []).map((d) => ({ ...d, original: d.body, saved: null, savedId: null, error: null })));
    });
  const reel = () =>
    start(async () => {
      const r = await generateReelAction(propertyId);
      setMsg(r.ok ? { ok: true, text: r.note ?? "Queued." } : { ok: false, text: r.error });
    });
  const update = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = (i: number) =>
    start(async () => {
      const d = rows[i];
      const r = await saveContentDraftAction({ propertyId, type: d.type, channel: d.channel, title: d.title, body: d.body, factKeys: d.factKeys, engine: d.engine, edited: d.body !== d.original });
      update(i, r.ok ? { saved: r.note ?? "Saved.", savedId: r.data?.id ?? null, error: null } : { error: r.error, saved: null });
    });

  if (buildings.length === 0) return <Card title="No buildings">The spine&apos;s inventory has no projects yet.</Card>;

  return (
    <div className="space-y-3">
      <Card bodyClassName="flex flex-wrap items-end gap-4 px-5 py-4">
        <Field label="Project" className="min-w-[260px]">
          <Select value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setRows([]); setWarnings([]); }}>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.locality}</option>)}
          </Select>
        </Field>
        <fieldset className="flex gap-3">
          <legend className="field-label">What to write</legend>
          {TYPES.map((t) => (
            <label key={t.value} className="flex h-11 items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" checked={types.includes(t.value)} onChange={(e) => setTypes(e.target.checked ? [...types, t.value] : types.filter((x) => x !== t.value))} />
              {t.label}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Button disabled={pending || !reraRegNo || types.length === 0} onClick={generate}>{pending ? "Writing…" : "Write posts"}</Button>
          <Button variant="secondary" disabled={pending || !reraRegNo} onClick={reel}>Make a short video</Button>
        </div>
        <div className="ml-auto text-right text-[12px] text-muted">
          <div>RERA number: <span className="font-tabular text-ink">{reraRegNo ?? "not added yet"}</span></div>
          {brand && <div>Brand: <span style={{ color: brand.primaryColor, fontFamily: brand.headingFont }}>{brand.builderName ?? "—"}</span></div>}
        </div>
      </Card>
      {!reraRegNo && <p role="alert" className="rounded-[10px] bg-trust-caution-bg px-4 py-2 text-[13px] text-trust-caution">Add your RERA registration number in <Link href="/marketing/brand-kit" className="font-semibold underline">Brand settings</Link> first — every post has to show it.</p>}
      {msg && <p role="status" className={`rounded-[10px] px-4 py-2 text-[13px] ${msg.ok ? "bg-trust-good-bg text-trust-good" : "bg-trust-risk-bg text-trust-risk"}`}>{msg.text}</p>}
      {warnings.length > 0 && (
        <ul className="rounded-[10px] bg-trust-caution-bg px-4 py-2 text-[13px] text-trust-caution">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <p className="text-[13px] text-muted">
          Written only from your project&apos;s verified details — nothing is made up. Edit anything you like, then save.
          {rows.some((r) => r.engine === "template") && " These are sample wordings: AI writing isn't switched on yet."}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {rows.map((d, i) => (
          <Card key={d.type} title={TYPES.find((t) => t.value === d.type)?.label} eyebrow={`For ${channelWord(d.channel)}`} action={<Badge tone="brand" dot={false}>AI-written</Badge>} bodyClassName="space-y-3 px-5 pb-5 pt-3">
            <Field label="Title"><Input value={d.title} onChange={(e) => update(i, { title: e.target.value, saved: null, savedId: null })} maxLength={160} /></Field>
            <Field label="Text" hint={d.body !== d.original ? "Edited — we'll check it again when you save." : "Your RERA number stays at the end."}>
              <TextArea rows={9} value={d.body} onChange={(e) => update(i, { body: e.target.value, saved: null, savedId: null })} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {d.savedId ? <span className="text-[13px] text-trust-good">Saved as a draft ✓</span> : <Button size="sm" disabled={pending} onClick={() => save(i)}>Save draft</Button>}
              {d.savedId && <TransitionControls objectType="content" objectId={d.savedId} status="draft" />}
            </div>
            {d.error && <p role="alert" className="text-[12px] text-trust-risk">{d.error}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { saveBrandKitAction, uploadLogoAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, TextArea } from "@/components/ui/Field";
import type { BrandKit } from "@/lib/premium/marketing-contract";

const FONTS = ["Playfair Display", "Inter", "Lora", "Merriweather", "Montserrat", "Poppins", "Source Sans 3", "DM Serif Display"];

const blank = { builderName: "", primaryColor: "#0f6b46", secondaryColor: "#b7791f", headingFont: "Playfair Display", bodyFont: "Inter", toneOfVoice: "", defaultReraRegNo: "" };

export function BrandKitForm({ initial }: { initial: BrandKit | null }) {
  const [v, setV] = useState(
    initial
      ? { builderName: initial.builderName ?? "", primaryColor: initial.primaryColor, secondaryColor: initial.secondaryColor, headingFont: initial.headingFont, bodyFont: initial.bodyFont, toneOfVoice: initial.toneOfVoice, defaultReraRegNo: initial.defaultReraRegNo ?? "" }
      : blank,
  );
  const [logo, setLogo] = useState(initial?.logoUrl ?? null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const save = () =>
    start(async () => {
      const r = await saveBrandKitAction({ ...v, builderName: v.builderName.trim() || null, defaultReraRegNo: v.defaultReraRegNo.trim() || null });
      setMsg(r.ok ? { ok: true, text: r.note ?? "Saved." } : { ok: false, text: r.error });
    });
  const upload = () =>
    start(async () => {
      const f = file.current?.files?.[0];
      if (!f) return setMsg({ ok: false, text: "Choose a logo file first." });
      const form = new FormData();
      form.set("logo", f);
      const r = await uploadLogoAction(form);
      if (r.ok) setLogo((r.data as string | null) ?? null);
      setMsg(r.ok ? { ok: true, text: r.note ?? "Uploaded." } : { ok: false, text: r.error });
    });

  return (
    <div className="grid grid-cols-[1fr_340px] gap-4">
      <Card title="Your brand" bodyClassName="space-y-4 px-5 pb-5 pt-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Builder name"><Input value={v.builderName} onChange={set("builderName")} maxLength={120} /></Field>
          <Field label="RERA registration number" hint="Shown on every post, message and page.">
            <Input value={v.defaultReraRegNo} onChange={set("defaultReraRegNo")} placeholder="PRM/KA/RERA/1251/309/PR/…" maxLength={80} />
          </Field>
          <Field label="Primary colour"><div className="flex gap-2"><input type="color" aria-label="Primary colour picker" value={v.primaryColor} onChange={set("primaryColor")} className="h-11 w-12 rounded-[8px] border border-line" /><Input value={v.primaryColor} onChange={set("primaryColor")} /></div></Field>
          <Field label="Secondary colour"><div className="flex gap-2"><input type="color" aria-label="Secondary colour picker" value={v.secondaryColor} onChange={set("secondaryColor")} className="h-11 w-12 rounded-[8px] border border-line" /><Input value={v.secondaryColor} onChange={set("secondaryColor")} /></div></Field>
          <Field label="Heading font"><Select value={v.headingFont} onChange={set("headingFont")}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
          <Field label="Body font"><Select value={v.bodyFont} onChange={set("bodyFont")}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
        </div>
        <Field label="How you like to sound" hint="e.g. warm and simple, no big promises. This shapes the wording only — never the facts.">
          <TextArea rows={4} value={v.toneOfVoice} onChange={set("toneOfVoice")} maxLength={1000} />
        </Field>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
          {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p>}
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Logo" eyebrow="A PNG or JPG image, under 2 MB" bodyClassName="space-y-3 px-5 pb-5 pt-3">
          <div className="flex h-28 items-center justify-center rounded-[10px] border border-dashed border-line-strong bg-surface-alt">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt="Builder logo" className="max-h-24 max-w-[260px] object-contain" /> : <span className="text-[13px] text-muted">No logo yet</span>}
          </div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo file" className="block w-full text-[13px]" />
          <Button size="sm" variant="secondary" disabled={pending} onClick={upload}>Upload logo</Button>
        </Card>
        <Card title="Preview" bodyClassName="px-5 pb-5 pt-3">
          <div className="rounded-[10px] p-4 text-white" style={{ background: v.primaryColor }}>
            <p className="text-[20px] leading-tight" style={{ fontFamily: v.headingFont }}>{v.builderName || "Builder name"}</p>
            <p className="mt-1 text-[13px] opacity-90" style={{ fontFamily: v.bodyFont }}>3 BHK homes · carpet-area pricing</p>
            <span className="mt-3 inline-block rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: v.secondaryColor }}>Book a site visit</span>
            <p className="mt-3 text-[11px] opacity-80">RERA Reg. No.: {v.defaultReraRegNo || "— not set —"}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

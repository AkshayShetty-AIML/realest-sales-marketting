"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addSpendAction, createBroadcastAction, createCampaignAction, createSegmentAction, previewListAction, publishDueAction, sendBroadcastAction, transitionAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ARCHETYPES, ARCHETYPE_LABEL, SOCIAL_CHANNELS, TRANSITIONS, type ObjectType, type PublishStatus, type SocialChannel } from "@/lib/premium/marketing-contract";
import { ACTIVITY_DAYS, GOALS, PLACEHOLDERS, SCORE_BAND_WORD, SPEND_CHANNELS, STAGE_ORDER, channelWord, standardCampaignName } from "@/lib/marketing/labels";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg }: { msg: Msg }) => (msg ? <p role="status" className={`text-[13px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p> : null);

/**
 * The next step for one item, in plain words — only the steps that are
 * allowed from where it is now. Approval checks run in the background and
 * explain themselves if something needs fixing.
 */
export function TransitionControls({ objectType, objectId, status, channels }: { objectType: ObjectType; objectId: string; status: PublishStatus; channels?: string[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const moves = TRANSITIONS[status].filter((to) => to !== "scheduled" && !(objectType === "broadcast" && to === "published"));
  const label = (to: PublishStatus) => {
    if (to === "submitted") return "Send for approval";
    if (to === "approved") return status === "submitted" ? "Approve" : "Cancel schedule";
    if (to === "published") return "Publish now";
    return status === "submitted" ? "Send back for changes" : "Withdraw";
  };
  const go = (to: PublishStatus) =>
    start(async () => {
      const r = await transitionAction({ objectType, objectId, to, publishChannels: to === "published" && objectType === "content" ? (channels?.length ? channels : ["instagram"]) : undefined });
      setMsg(r.ok ? { ok: true, text: r.note ?? "Done." } : { ok: false, text: r.error });
    });
  if (moves.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {moves.map((to) => (
          <Button key={to} size="sm" variant={to === "draft" || (to === "approved" && status !== "submitted") ? "ghost" : "primary"} disabled={pending} onClick={() => go(to)}>
            {label(to)}
          </Button>
        ))}
      </div>
      <Note msg={msg} />
    </div>
  );
}

export function ScheduleForm({ assetId }: { assetId: string }) {
  const [at, setAt] = useState("");
  const [channels, setChannels] = useState<SocialChannel[]>(["instagram"]);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date and time"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="!h-10" /></Field>
        <fieldset>
          <legend className="field-label">Where</legend>
          <div className="flex h-10 flex-wrap items-center gap-3 text-[14px] text-ink">
            {SOCIAL_CHANNELS.map((c) => (
              <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />{channelWord(c)}</label>
            ))}
          </div>
        </fieldset>
        <Button size="sm" disabled={pending || !at || channels.length === 0} onClick={() => start(async () => { const r = await transitionAction({ objectType: "content", objectId: assetId, to: "scheduled", scheduledAt: new Date(at).toISOString(), publishChannels: channels }); setMsg(r.ok ? { ok: true, text: "Scheduled." } : { ok: false, text: r.error }); })}>Schedule</Button>
      </div>
      <Note msg={msg} />
    </div>
  );
}

export function PublishDueButton() {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Note msg={msg} />
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await publishDueAction(); setMsg(r.ok ? { ok: true, text: r.note ?? "Done." } : { ok: false, text: r.error }); })}>Publish what&apos;s due</Button>
    </div>
  );
}

/** Add money spent — from a fixed list of places, never free text. */
export function SpendForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [v, setV] = useState({ campaignId: campaigns[0]?.id ?? "", channel: "instagram", amount: "", reach: "", source: "manual" as "manual" | "builder_passthrough" });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {campaigns.length > 1 && <Field label="Campaign"><Select value={v.campaignId} onChange={(e) => setV({ ...v, campaignId: e.target.value })}>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Spent on"><Select value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>{SPEND_CHANNELS.map((c) => <option key={c} value={c}>{channelWord(c)}</option>)}</Select></Field>
        <Field label="Amount (₹)"><Input inputMode="numeric" placeholder="25000" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d]/g, "") })} className="w-32" /></Field>
        <Field label="People reached (optional)"><Input inputMode="numeric" value={v.reach} onChange={(e) => setV({ ...v, reach: e.target.value.replace(/[^\d]/g, "") })} className="w-36" /></Field>
        <Field label="Paid by"><Select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as typeof v.source })}><option value="manual">Us</option><option value="builder_passthrough">The builder directly</option></Select></Field>
        <Button size="sm" disabled={pending || !v.amount} onClick={() => start(async () => { const r = await addSpendAction({ campaignId: v.campaignId, channel: v.channel, amountInr: Number(v.amount), reach: v.reach ? Number(v.reach) : undefined, source: v.source }); setMsg(r.ok ? { ok: true, text: "Added." } : { ok: false, text: r.error }); if (r.ok) setV({ ...v, amount: "", reach: "" }); })}>Add spend</Button>
      </div>
      <Note msg={msg} />
    </div>
  );
}

/** New campaign: pick project, goal, month, budget — the name follows the standard ("Cedar Heights · Site visits · Oct 2026"). */
export function NewCampaignForm({ projects }: { projects: { id: string; name: string }[] }) {
  const now = new Date();
  const [v, setV] = useState({ propertyId: projects[0]?.id ?? "", goal: "leads", month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, budget: "" });
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const project = projects.find((p) => p.id === v.propertyId);
  const name = project ? standardCampaignName(project.name, v.goal, v.month) : "";
  if (!open) return <Button onClick={() => setOpen(true)}>New campaign</Button>;
  return (
    <div className="card w-full space-y-3 p-5">
      <div className="grid grid-cols-4 gap-3">
        <Field label="Project"><Select value={v.propertyId} onChange={(e) => setV({ ...v, propertyId: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Goal"><Select value={v.goal} onChange={(e) => setV({ ...v, goal: e.target.value })}>{GOALS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</Select></Field>
        <Field label="Month"><Input type="month" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} /></Field>
        <Field label="Budget (₹, optional)"><Input inputMode="numeric" value={v.budget} onChange={(e) => setV({ ...v, budget: e.target.value.replace(/[^\d]/g, "") })} /></Field>
      </div>
      <p className="text-[14px] text-body">Campaign name: <span className="font-semibold text-ink">{name || "—"}</span></p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending || !project} onClick={() => start(async () => { const r = await createCampaignAction({ propertyId: v.propertyId, goal: v.goal, month: v.month, budgetInr: v.budget ? Number(v.budget) : undefined }); if (r.ok && r.data) router.push(`/marketing/campaigns/${encodeURIComponent(r.data.id)}`); else if (!r.ok) setMsg({ ok: false, text: r.error }); })}>Create campaign</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Note msg={msg} />
      </div>
    </div>
  );
}

/** Buyer list: tick who it's for — no rules to type. */
type ListDraft = { name: string; types: string[]; projects: string[]; bands: string[]; stage: string; days: string; campaignId: string };
const EMPTY_LIST: ListDraft = { name: "", types: [], projects: [], bands: [], stage: "", days: "", campaignId: "" };

function Chips({ legend, options, value, onChange }: { legend: string; options: { value: string; label: string }[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset>
      <legend className="field-label">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] ${value.includes(o.value) ? "border-brand bg-brand text-white" : "border-line bg-white text-body"}`}>
            <input type="checkbox" className="sr-only" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))} />
            {o.label}
          </label>
        ))}
        {options.length === 0 && <span className="text-[13px] text-muted">None yet</span>}
      </div>
    </fieldset>
  );
}

/** A buyer list is built from your leads by ticking options — never by typing in buyers. The count is live. */
export function SegmentForm({ campaigns, projects }: { campaigns: { id: string; name: string }[]; projects: { id: string; name: string }[] }) {
  const [v, setV] = useState<ListDraft>(EMPTY_LIST);
  const [msg, setMsg] = useState<Msg>(null);
  const [count, setCount] = useState<{ n: number | null; for: string } | null>(null);
  const [pending, start] = useTransition();
  const rules = {
    ...(v.projects.length ? { propertyIds: v.projects } : {}),
    ...(v.types.length ? { archetypes: v.types } : {}),
    ...(v.bands.length ? { scoreBands: v.bands } : {}),
    ...(v.stage ? { stageAtLeast: v.stage } : {}),
    ...(v.days ? { activeWithinDays: Number(v.days) } : {}),
    ...(v.campaignId ? { campaignId: v.campaignId } : {}),
  };
  const key = JSON.stringify(rules);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <Field label="List name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Hot NRI buyers" /></Field>
        <Field label="Has reached"><Select value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value })}><option value="">Any stage</option>{STAGE_ORDER.map((s) => <option key={s.value} value={s.value}>{s.label} or further</option>)}</Select></Field>
        <Field label="Last active"><Select value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })}><option value="">Any time</option>{ACTIVITY_DAYS.map((d) => <option key={d} value={d}>In the last {d === 1 ? "day" : `${d} days`}</option>)}</Select></Field>
        <Field label="Came from campaign"><Select value={v.campaignId} onChange={(e) => setV({ ...v, campaignId: e.target.value })}><option value="">Any campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </div>
      <Chips legend="Interested in (leave empty for all projects)" options={projects.map((p) => ({ value: p.id, label: p.name }))} value={v.projects} onChange={(projects) => setV({ ...v, projects })} />
      <Chips legend="Type of buyer (leave empty for all)" options={ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABEL[a] }))} value={v.types} onChange={(types) => setV({ ...v, types })} />
      <Chips legend="Lead score (leave empty for all)" options={Object.entries(SCORE_BAND_WORD).map(([value, label]) => ({ value, label }))} value={v.bands} onChange={(bands) => setV({ ...v, bands })} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await previewListAction(rules); setCount({ n: r.ok ? r.data!.count : null, for: key }); if (!r.ok) setMsg({ ok: false, text: r.error }); })}>Count buyers</Button>
        {count && count.for === key && count.n !== null && <span className="text-[13px] text-body">{count.n} buyer{count.n === 1 ? "" : "s"} match right now</span>}
        <Button size="sm" disabled={pending || !v.name.trim()} onClick={() => start(async () => { const r = await createSegmentAction({ name: v.name, rules }); setMsg(r.ok ? { ok: true, text: "List created." } : { ok: false, text: r.error }); if (r.ok) { setV(EMPTY_LIST); setCount(null); } })}>Create list</Button>
        <Note msg={msg} />
      </div>
      <p className="text-[12px] text-muted">Members are your leads that match, worked out again every time. Messages only ever go to buyers on the list who said yes to that channel when they enquired.</p>
    </div>
  );
}

/** Write a message with [First name]-style placeholders — buttons insert them; no codes to type. */
export function BroadcastForm({ segments, campaignId }: { segments: { id: string; name: string }[]; campaignId?: string }) {
  const [v, setV] = useState({ channel: "email" as "email" | "whatsapp", segmentId: segments[0]?.id ?? "", name: "", subject: "", body: "Hi [First name], ", language: "en" });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const insert = (word: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? v.body.length;
    const body = `${v.body.slice(0, at)}[${word}]${v.body.slice(el?.selectionEnd ?? at)}`;
    setV({ ...v, body });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + word.length + 2, at + word.length + 2); });
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Send by"><Select value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value as typeof v.channel })}><option value="email">Email</option><option value="whatsapp">WhatsApp (sends once WhatsApp is switched on)</option></Select></Field>
        <Field label="Send to"><Select value={v.segmentId} onChange={(e) => setV({ ...v, segmentId: e.target.value })}>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Message name (only you see this)"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Weekend site visits" /></Field>
      </div>
      {v.channel === "email" ? (
        <Field label="Email subject"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
      ) : (
        <Field label="Language"><Select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })} className="w-48"><option value="en">English</option><option value="hi">Hindi</option></Select></Field>
      )}
      <div>
        <span className="field-label">Message</span>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          Add:
          {PLACEHOLDERS.map((p) => <button key={p.word} type="button" onClick={() => insert(p.word)} className="rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-ink hover:border-brand">{p.word}</button>)}
        </div>
        <textarea ref={box} rows={5} className="control" aria-label="Message" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
        <p className="mt-1 text-[12px] text-muted">Words in [brackets] are filled in for each buyer from the project&apos;s verified details. Your RERA number is added at the end automatically.</p>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending || !v.name.trim() || !v.segmentId || (v.channel === "email" && !v.subject.trim())} onClick={() => start(async () => { const r = await createBroadcastAction({ ...v, campaignId }); setMsg(r.ok ? { ok: true, text: "Saved as a draft. Send it for approval when it's ready." } : { ok: false, text: r.error }); })}>Save message</Button>
        <Note msg={msg} />
      </div>
    </div>
  );
}

export function SendBroadcastButton({ id }: { id: string }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1 text-right">
      <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await sendBroadcastAction(id); setMsg(r.ok ? { ok: true, text: r.note ?? "Sent." } : { ok: false, text: r.error }); })}>Send now</Button>
      <Note msg={msg} />
    </div>
  );
}

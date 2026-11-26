"use client";

import { useState } from "react";
import { generateProposalAction, holdUnitAction, releaseUnitAction, sendProposalAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useAction } from "./controls";

/**
 * A lead's units and proposals. Hold / release go through premium's
 * allocation lock (the answer shown is premium's — never a status kept
 * here); a proposal is made from premium's prices and cost rules, saved as a
 * version, and sending it waits for an approval because it carries prices.
 */

export interface LeadUnitRow {
  unitId: string;
  label: string;
  detail: string;
  status: "available" | "held" | "sold";
  indicative: boolean;
  holdNote: string | null;
  heldForThisLead: boolean;
}

export interface ProposalRow {
  id: string;
  version: number;
  unitLabel: string;
  total: string;
  toConfirm: string[];
  createdLabel: string;
  sendStatus: "draft" | "awaiting_approval" | "sent" | "declined" | "not_sent";
  note: string | null;
}

const TONE: Record<LeadUnitRow["status"], BadgeTone> = { available: "good", held: "caution", sold: "neutral" };
const SEND: Record<ProposalRow["sendStatus"], { tone: BadgeTone; label: string }> = {
  draft: { tone: "neutral", label: "Not sent" },
  awaiting_approval: { tone: "caution", label: "Waiting for approval" },
  sent: { tone: "good", label: "Sent" },
  declined: { tone: "risk", label: "Declined" },
  not_sent: { tone: "risk", label: "Not sent" },
};

const newKey = () => crypto.randomUUID();
const inTwoDays = () => {
  const d = new Date(Date.now() + 48 * 3_600_000 + 5.5 * 3_600_000);
  return d.toISOString().slice(0, 16);
};

function UnitRow({ leadId, u }: { leadId: string; u: LeadUnitRow }) {
  const { pending, go, feedback } = useAction();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(inTwoDays);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const done = <T,>(r: T) => (setKey(newKey()), setOpen(false), r);
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
            {u.label} {u.indicative ? <Badge tone="neutral">Awaiting confirmed layout</Badge> : <Badge tone={TONE[u.status]}>{u.status[0].toUpperCase() + u.status.slice(1)}</Badge>}
          </p>
          <p className="text-[12px] text-muted">{u.detail}</p>
          {u.holdNote && <p className="text-[12px] text-ochre-ink">{u.holdNote}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {!u.indicative && u.status === "available" && <Button size="sm" variant="secondary" className="!h-8" disabled={pending} onClick={() => setOpen((o) => !o)}>Hold for this buyer</Button>}
          {u.heldForThisLead && <Button size="sm" variant="secondary" className="!h-8" disabled={pending} onClick={() => go(() => releaseUnitAction(u.unitId, leadId, "released from the lead page", key).then(done))}>Release</Button>}
          {!u.indicative && u.status !== "sold" && <Button size="sm" variant="ghost" className="!h-8" disabled={pending} onClick={() => go(() => generateProposalAction(leadId, u.unitId))}>Make proposal</Button>}
        </div>
      </div>
      {open && (
        <div className="mt-2 grid gap-2 rounded-[10px] border border-line bg-surface-alt p-2.5 sm:grid-cols-[1fr_1fr_auto]">
          <Input type="datetime-local" className="!h-8 !text-[13px]" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Hold until (IST)" />
          <Input className="!h-8 !text-[13px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (e.g. token cheque Monday)" maxLength={300} />
          <Button size="sm" className="!h-8" disabled={pending || !until} onClick={() => go(() => holdUnitAction(u.unitId, leadId, new Date(`${until}:00+05:30`).toISOString(), reason, key).then(done))}>{pending ? "Holding…" : "Hold"}</Button>
        </div>
      )}
      {feedback}
    </li>
  );
}

function ProposalItem({ leadId, p }: { leadId: string; p: ProposalRow }) {
  const { pending, go, feedback } = useAction();
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">Version {p.version} · {p.unitLabel} · all-in {p.total}</p>
          <p className="text-[12px] text-muted">{p.createdLabel}{p.toConfirm.length ? ` · developer to confirm: ${p.toConfirm.join(", ")}` : ""}</p>
          {p.note && <p className="text-[12px] text-muted">{p.note}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={SEND[p.sendStatus].tone}>{SEND[p.sendStatus].label}</Badge>
          <a className="text-[12px] font-medium text-brand hover:underline" href={`/api/proposals/${p.id}`} target="_blank" rel="noreferrer">Open PDF</a>
          {(p.sendStatus === "draft" || p.sendStatus === "declined" || p.sendStatus === "not_sent") && <Button size="sm" variant="secondary" className="!h-8" disabled={pending} onClick={() => go(() => sendProposalAction(leadId, p.id))}>Send for approval</Button>}
        </div>
      </div>
      {feedback}
    </li>
  );
}

export function LeadUnits({ leadId, units, proposals }: { leadId: string; units: LeadUnitRow[]; proposals: ProposalRow[] }) {
  return (
    <div>
      <ul className="divide-y divide-line">
        {units.map((u) => <UnitRow key={u.unitId} leadId={leadId} u={u} />)}
        {units.length === 0 && <li className="py-2 text-[13px] text-muted">No units loaded for this project yet.</li>}
      </ul>
      {proposals.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Proposals</h3>
          <ul className="divide-y divide-line">{proposals.map((p) => <ProposalItem key={p.id} leadId={leadId} p={p} />)}</ul>
        </>
      )}
    </div>
  );
}

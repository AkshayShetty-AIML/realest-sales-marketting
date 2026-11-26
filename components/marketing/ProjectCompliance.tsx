"use client";

import { useState, useTransition } from "react";
import { saveProjectComplianceAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Segmented } from "@/components/ui/Field";

export interface ProjectComplianceRow {
  projectId: string;
  name: string;
  mode: "rera" | "exempt" | null;
  reraRegNo: string;
  statement: string;
  reason: string;
  evidenceRef: string;
  /** Where the line comes from today, in words. */
  current: string;
}

/** One project's RERA registration number OR its exemption (statement, reason, evidence reference). */
function Row({ row }: { row: ProjectComplianceRow }) {
  const [v, setV] = useState({ mode: row.mode ?? "rera", reraRegNo: row.reraRegNo, statement: row.statement, reason: row.reason, evidenceRef: row.evidenceRef });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-ink">{row.name}</p>
        <p className="text-[12px] text-muted">{row.current}</p>
      </div>
      <Segmented label={`${row.name}: RERA status`} value={v.mode} onChange={(mode) => setV({ ...v, mode })} options={[{ value: "rera", label: "RERA registered" }, { value: "exempt", label: "Exempt from RERA" }]} />
      {v.mode === "rera" ? (
        <div className="mt-3 max-w-md"><Field label="RERA registration number"><Input value={v.reraRegNo} onChange={(e) => setV({ ...v, reraRegNo: e.target.value })} maxLength={80} placeholder="PRM/KA/RERA/…" /></Field></div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Exemption statement (shown on every message)"><Input value={v.statement} onChange={(e) => setV({ ...v, statement: e.target.value })} maxLength={160} placeholder="Not required to register under RERA" /></Field>
          <Field label="Reason"><Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} maxLength={200} placeholder="e.g. plot area under 500 m², 8 units or fewer" /></Field>
          <Field label="Evidence reference"><Input value={v.evidenceRef} onChange={(e) => setV({ ...v, evidenceRef: e.target.value })} maxLength={120} placeholder="e.g. legal opinion LO-2026-14" /></Field>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveProjectComplianceAction({ projectId: row.projectId, ...v }); setMsg(r.ok ? { ok: true, text: r.note ?? "Saved." } : { ok: false, text: r.error }); })}>{pending ? "Saving…" : "Save"}</Button>
        {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p>}
      </div>
    </li>
  );
}

export function ProjectComplianceList({ rows }: { rows: ProjectComplianceRow[] }) {
  return <ul className="divide-y divide-line">{rows.map((r) => <Row key={r.projectId} row={r} />)}</ul>;
}

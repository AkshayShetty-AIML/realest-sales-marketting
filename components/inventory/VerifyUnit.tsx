"use client";

import { useState } from "react";
import { verifyUnitAction } from "@/app/actions";
import { UNIT_STATUSES, type UnitStatus } from "@/lib/premium/contract";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { useAction } from "@/components/lead/controls";

/**
 * One unit's verification. The one-tap "Verify" confirms the current status
 * as of now. "Change" opens status + when-checked (IST) for a status change
 * or a past site check — premium refuses (409) a check older than the one it
 * has, and that refusal is shown as-is.
 */
export function VerifyUnit({ unitId, status }: { unitId: string; status: UnitStatus }) {
  const { pending, go, feedback } = useAction();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<UnitStatus>(status);
  const [at, setAt] = useState("");
  const submit = (s: UnitStatus, when: string) => go(() => verifyUnitAction(unitId, s, when ? new Date(`${when}:00+05:30`).toISOString() : null));
  return (
    <div className="min-w-[150px]">
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="!h-8" disabled={pending} onClick={() => submit(status, "")}>{pending ? "Saving…" : "Verify"}</Button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-8 rounded-control px-2 text-[12px] font-medium text-brand hover:bg-brand-mist">
          Change
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-[10px] border border-line bg-surface-alt p-2.5">
          <Select className="!h-8 !text-[13px]" value={value} disabled={pending} aria-label={`New status for ${unitId}`} onChange={(e) => setValue(e.target.value as UnitStatus)}>
            {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </Select>
          <Input type="datetime-local" className="!h-8 !text-[13px]" value={at} onChange={(e) => setAt(e.target.value)} aria-label="When you checked (IST, blank = now)" title="When you checked it (IST). Leave blank for now." />
          <Button size="sm" variant="secondary" className="!h-8 w-full" disabled={pending} onClick={() => submit(value, at)}>Save</Button>
        </div>
      )}
      {feedback}
    </div>
  );
}

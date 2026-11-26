"use client";

import { useState } from "react";
import { verifyUnitAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { useAction } from "@/components/lead/controls";

/**
 * One unit's verification: confirms its CURRENT status as of now (or as of
 * an earlier site check, IST). It never changes a status — holds, releases
 * and sales go through the grid's allocation lock. Premium refuses (409) a
 * check older than the one it has, and that refusal is shown as-is.
 */
export function VerifyUnit({ unitId }: { unitId: string }) {
  const { pending, go, feedback } = useAction();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState("");
  const submit = (when: string) => go(() => verifyUnitAction(unitId, when ? new Date(`${when}:00+05:30`).toISOString() : null));
  return (
    <div className="min-w-[150px]">
      <div className="flex items-center gap-1.5">
        <Button size="sm" className="!h-8" disabled={pending} onClick={() => submit("")}>{pending ? "Saving…" : "Verify"}</Button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="h-8 rounded-control px-2 text-[12px] font-medium text-brand hover:bg-brand-mist">
          Checked earlier?
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-[10px] border border-line bg-surface-alt p-2.5">
          <Input type="datetime-local" className="!h-8 !text-[13px]" value={at} onChange={(e) => setAt(e.target.value)} aria-label="When you checked (IST)" />
          <Button size="sm" variant="secondary" className="!h-8 w-full" disabled={pending || !at} onClick={() => submit(at)}>Save check</Button>
        </div>
      )}
      {feedback}
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { toggleSequenceAction } from "@/app/actions";

/** Active / paused switch for a sequence row. */
export function SequenceToggle({ id, active, name }: { id: string; active: boolean; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${name}: ${active ? "on" : "paused"}`}
      disabled={pending}
      onClick={() => start(async () => void (await toggleSequenceAction(id, !active)))}
      className={`inline-flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-[12px] font-medium transition-colors disabled:opacity-50 ${active ? "bg-trust-good-bg text-forest" : "bg-surface-alt text-muted"}`}
    >
      {active ? "Active" : "Paused"}
      <span className={`relative h-5 w-9 rounded-full transition-colors ${active ? "bg-forest" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-control transition-all ${active ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

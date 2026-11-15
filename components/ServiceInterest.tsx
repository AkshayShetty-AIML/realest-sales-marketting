"use client";

import { useState, useTransition } from "react";
import { registerServiceInterestAction } from "@/app/actions";
import { Button } from "@/components/ui/Button";

/** "Tell me when it's ready" — one tap, no fields. */
export function InterestButton({ service, asked }: { service: string; asked: boolean }) {
  const [done, setDone] = useState(asked);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (done) return <p role="status" className="text-[13px] font-medium text-trust-good">We&apos;ll tell you when it&apos;s ready.</p>;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await registerServiceInterestAction(service); if (r.ok) setDone(true); else setError(r.error); })}>
        {pending ? "Saving…" : "Tell me when it's ready"}
      </Button>
      {error && <span role="status" className="text-[12px] text-trust-risk">{error}</span>}
    </span>
  );
}

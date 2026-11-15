/**
 * LIFECYCLE TIMELINE (asset sheet → "Journey"): one sequence of steps, each
 * done or not, with what happened. Read-only; the steps come from existing
 * lead data (the thread and premium visits).
 */
export interface LifecycleStep {
  label: string;
  done: boolean;
  detail: string;
  tone?: "risk";
}

export function Lifecycle({ steps }: { steps: LifecycleStep[] }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-3 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden className={`absolute left-[7px] top-4 h-[calc(100%-8px)] w-px ${s.done ? "bg-forest/50" : "bg-line-strong"}`} />}
          <span
            aria-hidden
            className={`relative mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full ${
              s.tone === "risk" ? "bg-rust" : s.done ? "bg-forest" : i === current ? "border-2 border-forest bg-white" : "border-2 border-line-strong bg-white"
            }`}
          >
            {s.done && <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white"><path d="m2.5 6.2 2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
          <div className="min-w-0">
            <p className={`text-[13px] font-medium ${s.done ? "text-ink" : i === current ? "text-ink" : "text-muted"}`}>
              {s.label}
              <span className="sr-only">{s.done ? " — done" : " — not yet"}</span>
            </p>
            <p className={`text-[12px] ${s.tone === "risk" ? "text-rust" : "text-muted"}`}>{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

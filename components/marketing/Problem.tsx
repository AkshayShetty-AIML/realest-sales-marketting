/** A friendly load error for the marketing screens — no settings names, no codes (the detail is kept for support in the title). */
export function Problem({ detail }: { detail?: string | null }) {
  return (
    <div className="card border-l-4 border-l-trust-risk-fill p-5" role="alert" title={detail ?? undefined}>
      <p className="font-medium text-trust-risk">We couldn&apos;t load this just now</p>
      <p className="mt-1 text-[14px] text-ink">Please refresh the page in a minute. If it keeps happening, let your support contact know.</p>
    </div>
  );
}

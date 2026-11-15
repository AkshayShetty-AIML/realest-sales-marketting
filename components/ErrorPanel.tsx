export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="card border-l-4 border-l-trust-risk-fill p-5" role="alert">
      <p className="font-medium text-trust-risk">The premium app didn&apos;t answer</p>
      <p className="mt-1 text-sm text-ink">{message}</p>
      <p className="mt-2 text-[13px] text-muted">Check the Status page: PREMIUM_API_BASE_URL, SALES_INTERNAL_API_KEY, and that the premium app is running.</p>
    </div>
  );
}

import { redirect } from "next/navigation";
import { authConfigured, unauthenticatedDemoAllowed } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Shown when rep sign-in isn't configured. Lists env var NAMES only. */
export default function SetupPage() {
  if (authConfigured() || unauthenticatedDemoAllowed()) redirect("/inbox");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 py-16">
      <div className="card w-full max-w-xl p-8">
      <p className="eyebrow text-sage-ink">Sales desk</p>
      <h1 className="type-h1 mt-1">Configure rep sign-in</h1>
      <p className="mt-4 text-sm">Lead data is only shown to signed-in reps. Add Clerk keys to <code>.env.local</code> and restart:</p>
      <pre className="card mt-4 p-4 font-mono text-[13px] text-ink">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=…{"\n"}CLERK_SECRET_KEY=…</pre>
      <p className="mt-4 text-sm text-muted">For a local demo without accounts, set <code>SALES_ALLOW_UNAUTHENTICATED_DEMO=true</code> instead. Never on a shared host.</p>
      </div>
    </main>
  );
}

import { SignOut } from "@/components/SignOut";

/** Signed in, but not on the sales roster. Shows nothing about leads. */
export default function NotARepPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 py-16">
      <div className="card w-full max-w-xl p-8">
      <p className="eyebrow text-sage-ink">Sales desk</p>
      <h1 className="type-h1 mt-1">You&apos;re not on the sales team</h1>
      <p className="mt-4 text-sm">
        This account is signed in but isn&apos;t on the rep roster. Ask an admin to add your verified email as a rep (for a local
        setup: <code>SEED_REP_EMAIL=you@example.com npm run db:seed</code>), then sign in again.
      </p>
      <div className="mt-6"><SignOut /></div>
      </div>
    </main>
  );
}

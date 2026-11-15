import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/env";

export default function SignInPage() {
  if (!authConfigured()) redirect("/setup");
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div>
        <p className="eyebrow mb-3 text-center text-sage-ink">Sales desk · reps only</p>
        <SignIn />
      </div>
    </main>
  );
}

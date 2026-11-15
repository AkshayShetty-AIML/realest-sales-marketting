"use client";

import { SignOutButton } from "@clerk/nextjs";
import { buttonClass } from "./ui/Button";

const CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Clerk's button needs <ClerkProvider>, which is only mounted when Clerk is configured. */
export function SignOut() {
  if (!CLERK) return null;
  return (
    <SignOutButton>
      <button className={buttonClass({ variant: "secondary", size: "sm" })}>Sign out</button>
    </SignOutButton>
  );
}

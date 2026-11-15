import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authConfigured, unauthenticatedDemoAllowed } from "./env";
import { store } from "./store";

/**
 * WHO IS THE REP. Every page and every server action starts here. Reps sign
 * in with Clerk; the session is mapped to a rep in the ROSTER (the store's
 * reps) by Clerk user id, then by verified email (and the id is remembered).
 * A signed-in user who is NOT on the roster gets nothing — being able to sign
 * in to a Clerk instance is not the same as working on the sales team (and
 * must never be, in case the instance is ever shared with buyers).
 *
 * Without Clerk keys the app refuses to show data — unless
 * SALES_ALLOW_UNAUTHENTICATED_DEMO=true, which runs as a labelled demo rep on
 * localhost.
 */

export interface RepSession {
  repId: string;
  name: string;
  email: string | null;
  demo: boolean;
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in to continue.");
  }
}

type Resolved = RepSession | "signed-out" | "not-a-rep";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const hostOf = (v: string | null) => (v ?? "").split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();

/**
 * The no-sign-in demo identity is granted ONLY to requests that come from
 * this machine — checked here as well as in proxy.ts, because server actions
 * can be POSTed to any page path (including the public /b/* buyer pages).
 */
async function fromLocalhost(): Promise<boolean> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-host");
  return LOCAL.has(hostOf(h.get("host"))) && (!forwarded || LOCAL.has(hostOf(forwarded)));
}

async function resolve(): Promise<Resolved> {
  if (!authConfigured()) {
    if (!unauthenticatedDemoAllowed() || !(await fromLocalhost())) return "signed-out";
    const first = (await store().listReps()).find((r) => r.active && !r.demo);
    return { repId: first?.id ?? "demo-rep", name: first ? `${first.name} (demo, no auth)` : "Demo rep (no auth)", email: null, demo: true };
  }
  const { userId } = await auth();
  if (!userId) return "signed-out";
  const user = await currentUser();
  const primary = user?.primaryEmailAddress;
  // Only a VERIFIED email may claim a roster seat.
  const email = primary?.verification?.status === "verified" ? primary.emailAddress.toLowerCase() : null;
  const reps = await store().listReps();
  const rep = reps.find((r) => r.clerkUserId === userId) ?? (email ? reps.find((r) => r.email.toLowerCase() === email && !r.clerkUserId) : undefined);
  if (!rep || !rep.active) return "not-a-rep";
  if (rep.clerkUserId !== userId) await store().upsertRep({ ...rep, clerkUserId: userId });
  return { repId: rep.id, name: rep.name, email, demo: false };
}

/** For pages: redirects to sign-in, the setup page, or "not a rep". */
export async function requireRep(): Promise<RepSession> {
  const session = await resolve();
  if (session === "not-a-rep") redirect("/not-a-rep");
  if (session === "signed-out") redirect(authConfigured() ? "/sign-in" : "/setup");
  return session;
}

/** For server actions: throws instead of redirecting. */
export async function requireRepForAction(): Promise<RepSession> {
  const session = await resolve();
  if (session === "signed-out" || session === "not-a-rep") throw new NotSignedIn();
  return session;
}

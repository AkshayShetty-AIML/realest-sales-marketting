import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

/**
 * Front door.
 *  - Twilio webhooks (/api/twilio/*) and BUYER links (/b/<token>) are always
 *    reachable — they authenticate by Twilio signature / by the random token.
 *  - With Clerk configured: everything else requires a signed-in rep (pages
 *    ALSO check the roster themselves via requireRep()).
 *  - WITHOUT Clerk (local demo): the desk is served to LOCALHOST ONLY. A
 *    request arriving through a tunnel (ngrok etc.) can reach the Twilio
 *    webhooks and nothing else, so opening a tunnel never exposes leads.
 */
const isPublic = createRouteMatcher(["/sign-in(.*)", "/setup", "/not-a-rep", "/api/twilio/(.*)", "/b/(.*)"]);
/** Reachable from anywhere: Twilio webhooks (signature-checked) and buyer links (token-checked). */
const isOpenToAll = (request: NextRequest) => request.nextUrl.pathname.startsWith("/api/twilio/") || request.nextUrl.pathname.startsWith("/b/");

const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const hostname = (value: string) => value.split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();

/**
 * Local = the Host AND any X-Forwarded-Host are local names. Next itself sets
 * X-Forwarded-Host to the local host; a tunnel (ngrok, cloudflared) carries
 * the public domain in one of them.
 */
function isLocal(request: NextRequest): boolean {
  const forwarded = request.headers.get("x-forwarded-host");
  return LOCAL_HOSTS.has(hostname(request.headers.get("host") ?? "")) && (!forwarded || LOCAL_HOSTS.has(hostname(forwarded)));
}

const clerk = clerkMiddleware(async (auth, request) => {
  if (!isPublic(request)) await auth.protect();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (configured) return clerk(request, event);
  if (isOpenToAll(request) || isLocal(request)) return NextResponse.next();
  return new NextResponse("This sales desk is only served on localhost until rep sign-in (Clerk) is configured.", { status: 403 });
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};

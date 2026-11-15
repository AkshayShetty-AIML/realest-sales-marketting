import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRepForAction, type RepSession } from "@/lib/auth";
import { harness, type Workspace } from "@/lib/marketing/harness";

/**
 * /api/marketing/* — the harness's operator API. Every route: a signed-in
 * operator (the rep roster; proxy.ts also guards /api), and for anything under
 * a workspace, MEMBERSHIP of that workspace — a non-member gets 404, the same
 * as a workspace that doesn't exist, so one builder can't even probe for
 * another's. Errors come back as { error } — never a stack, never a key.
 * TODO(roles): gate on a marketing-operator role when roles land.
 */

export const dynamic = "force-dynamic";

export type Params<T extends Record<string, string>> = { params: Promise<T> };

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const ok = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function operator(): Promise<RepSession | NextResponse> {
  try {
    return await requireRepForAction();
  } catch {
    return bad("unauthorized", 401);
  }
}

/** The operator, and the workspace — only if they are a member of it. */
export async function member(workspaceId: string): Promise<{ session: RepSession; workspace: Workspace } | NextResponse> {
  const session = await operator();
  if (session instanceof NextResponse) return session;
  const workspace = await harness().getWorkspace(workspaceId);
  if (!workspace || !workspace.members.includes(session.repId)) return bad("not found", 404);
  return { session, workspace };
}

/** A schedule's trigger: a 5-field cron (workspace timezone) or an event name. */
export const Trigger = z.discriminatedUnion("kind", [z.object({ kind: z.literal("cron"), cron: z.string().min(9).max(100) }), z.object({ kind: z.literal("event"), event: z.string().min(2).max(64) })]);

export const actorOf = (session: RepSession) => `operator:${session.repId}`;

export async function body<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return bad("expected a JSON body");
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : bad(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
}

/**
 * Runs a handler; known errors become 4xx in plain words, anything else a bare 500.
 * Matched by NAME, not instanceof: the harness singleton may be created in another
 * server chunk (instrumentation.ts), whose error classes are different objects.
 */
const KNOWN: Record<string, [number, string | null]> = { HarnessOff: [409, null], LinkTaken: [409, null], ProjectTaken: [409, null], DeleteRefused: [409, null], LocalCopyRefused: [400, null], ScheduleError: [400, null], NotFound: [404, "not found"] };

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    const known = error instanceof Error ? KNOWN[error.name] : undefined;
    if (known) return bad(known[1] ?? (error as Error).message, known[0]);
    if (error instanceof Error && /^no (snapshot provider|tool) /.test(error.message)) return bad(error.message, 400);
    console.warn("[api/marketing] failed:", error instanceof Error ? error.message : error);
    return bad("something went wrong", 500);
  }
}

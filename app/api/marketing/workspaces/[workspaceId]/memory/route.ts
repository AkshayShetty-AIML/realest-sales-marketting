import { NextResponse } from "next/server";
import { z } from "zod";
import { harness } from "@/lib/marketing/harness";
import { actorOf, body, handle, member, ok, type Params } from "../../../_shared";

export const dynamic = "force-dynamic";

/** GET ?q=…&kind=… — company memory: retrieval when q is set, else a listing. */
export async function GET(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const kinds = url.searchParams.getAll("kind");
    const memory = harness().memory(m.workspace.id);
    if (q) return ok({ results: await memory.retrieve(q, { kinds: kinds.length ? kinds : undefined, limit: 20 }) });
    return ok({ items: await memory.list(kinds.length ? kinds : undefined) });
  });
}

const Upsert = z.object({
  kind: z.string().regex(/^[a-z][a-z_]{1,31}$/),
  key: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(20000).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  /** Third-party content (e.g. a lead's own words) must be stored as untrusted. */
  trust: z.enum(["trusted", "untrusted"]).optional(),
});

/** POST — add / update one memory item (upserts by kind + key). */
export async function POST(request: Request, { params }: Params<{ workspaceId: string }>) {
  return handle(async () => {
    const m = await member((await params).workspaceId);
    if (m instanceof NextResponse) return m;
    const input = await body(request, Upsert);
    if (input instanceof NextResponse) return input;
    return ok({ item: await harness().memory(m.workspace.id).upsert({ ...input, source: actorOf(m.session) }) }, 201);
  });
}

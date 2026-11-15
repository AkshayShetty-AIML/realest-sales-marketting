import { NextResponse } from "next/server";
import { requireRepForAction } from "@/lib/auth";
import { store } from "@/lib/store";
import { renderBrochurePdf } from "@/lib/brochure/pdf";

/** GET /api/brochures/:id — a REP downloads a brochure (rep session required; proxy.ts also guards /api). */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRepForAction();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const brochure = await store().getBrochure(id);
  if (!brochure) return NextResponse.json({ error: "not found" }, { status: 404 });
  const pdf = await renderBrochurePdf(brochure.content);
  const slug = brochure.content.property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug}-brochure.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

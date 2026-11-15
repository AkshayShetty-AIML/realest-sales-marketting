import { NextResponse } from "next/server";
import { resolveLink } from "@/lib/links";
import { store } from "@/lib/store";
import { renderBrochurePdf } from "@/lib/brochure/pdf";

/** GET /b/<token>/brochure.pdf — the BUYER's copy. The brochure-purpose token is the credential. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const resolved = await resolveLink((await params).token);
  if (!resolved.ok || resolved.link.purpose !== "brochure" || !resolved.link.brochureId) return new NextResponse("This link isn't valid or has expired.", { status: 404 });
  const brochure = await store().getBrochure(resolved.link.brochureId);
  if (!brochure || brochure.leadId !== resolved.link.leadId) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderBrochurePdf(brochure.content);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="brochure.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

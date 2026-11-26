import { NextResponse } from "next/server";
import { requireRepForAction } from "@/lib/auth";
import { store } from "@/lib/store";
import { renderProposalPdf } from "@/lib/proposals/pdf";

/** GET /api/proposals/:id — a REP opens one proposal version (rep session required; proxy.ts also guards /api). */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRepForAction();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const proposal = await store().getProposal(id);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const pdf = await renderProposalPdf(proposal);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="proposal-v${proposal.version}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

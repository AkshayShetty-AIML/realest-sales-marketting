import { NextResponse } from "next/server";
import { resolveLink } from "@/lib/links";
import { store } from "@/lib/store";
import { renderProposalPdf } from "@/lib/proposals/pdf";

/** GET /b/<token>/proposal.pdf — the BUYER's copy of one proposal version. The proposal-purpose token is the credential. */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const resolved = await resolveLink((await params).token);
  if (!resolved.ok || resolved.link.purpose !== "proposal" || !resolved.link.proposalId) return new NextResponse("This link isn't valid or has expired.", { status: 404 });
  const proposal = await store().getProposal(resolved.link.proposalId);
  if (!proposal || proposal.leadId !== resolved.link.leadId) return new NextResponse("Not found.", { status: 404 });
  const pdf = await renderProposalPdf(proposal);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="proposal-v${proposal.version}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" },
  });
}

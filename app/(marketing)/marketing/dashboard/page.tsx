import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { AttributionReport, Campaign, ContentAsset, LandingPage } from "@/lib/premium/marketing-contract";
import { inr } from "@/lib/grounding/facts";
import { channelWord } from "@/lib/marketing/labels";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Card, Stat } from "@/components/ui/Card";
import { Problem } from "@/components/marketing/Problem";
import { SpendForm } from "@/components/marketing/Controls";
import { buttonClass } from "@/components/ui/Button";
import { FirstReplyStats } from "@/components/marketing/FirstReplyStats";
import { replyStats, type ReplyStats } from "@/lib/automation/response-time";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n === null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);

/**
 * OVERVIEW — what the money did: spent → enquiries → site visits → bookings,
 * and the cost of each. Then what's waiting for you. Plain words, no ids.
 */
export default async function MarketingOverview() {
  const rep = await requireRep();
  let campaigns: Campaign[] = [];
  let content: ContentAsset[] = [];
  let pages: LandingPage[] = [];
  let report: AttributionReport | null = null;
  let replies: ReplyStats | null = null;
  let error: string | null = null;
  try {
    [campaigns, content, pages, report, replies] = await Promise.all([marketing.listCampaigns({ limit: 200 }), marketing.listContent({ limit: 200 }), marketing.listLandingPages({ limit: 200 }), marketing.attribution(), store().listFirstReplies().then((rows) => replyStats(rows))]);
  } catch (e) {
    error = e instanceof Error ? e.message : null;
  }
  const t = report?.totals;
  const waiting = [...content, ...pages, ...campaigns].filter((x) => x.status === "submitted").length;
  const drafts = content.filter((c) => c.status === "draft").length;
  const scheduled = content.filter((c) => c.status === "scheduled").length;
  const first = rep.name.split(/\s+/)[0];

  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title={`Hello, ${first}`} description="How your marketing is doing, and what needs you today." actions={<Link href="/marketing/campaigns" className={buttonClass({ size: "sm" })}>See campaigns</Link>} />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Spent so far" value={inr(t?.spendInr ?? 0)} />
            <Stat label="Enquiries" value={t?.leads ?? 0} tone="brand" hint={t?.costPerLead ? `${money(t.costPerLead)} each` : undefined} />
            <Stat label="Site visits" value={t?.siteVisits ?? 0} hint={t?.costPerSiteVisit ? `${money(t.costPerSiteVisit)} each` : undefined} />
            <Stat label="Bookings" value={t?.bookings ?? 0} tone="brand" hint={t?.costPerBooking ? `${money(t.costPerBooking)} each` : undefined} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Link href="/marketing/approvals" className="card block px-5 py-4 hover:border-brand">
              <p className="font-display text-[28px] leading-none text-ink">{waiting}</p>
              <p className="mt-1.5 text-[14px] text-body">waiting for your approval</p>
            </Link>
            <Link href="/marketing/content" className="card block px-5 py-4 hover:border-brand">
              <p className="font-display text-[28px] leading-none text-ink">{drafts}</p>
              <p className="mt-1.5 text-[14px] text-body">post drafts not yet sent for approval</p>
            </Link>
            <Link href="/marketing/calendar" className="card block px-5 py-4 hover:border-brand">
              <p className="font-display text-[28px] leading-none text-ink">{scheduled}</p>
              <p className="mt-1.5 text-[14px] text-body">posts scheduled</p>
            </Link>
          </div>

          {replies && <FirstReplyStats stats={replies} scope="a buyer's enquiry" />}

          {report && report.campaigns.length > 0 && (
            <Card className="mt-4" title="Results by campaign" eyebrow="What each campaign cost, and what it brought in">
              <table className="data-table">
                <thead><tr><th scope="col">Campaign</th><th scope="col" className="text-right">Spent</th><th scope="col" className="text-right">Enquiries</th><th scope="col" className="text-right">Cost per enquiry</th><th scope="col" className="text-right">Site visits</th><th scope="col" className="text-right">Cost per visit</th><th scope="col" className="text-right">Bookings</th><th scope="col" className="text-right">Cost per booking</th></tr></thead>
                <tbody>
                  {report.campaigns.map((c) => (
                    <tr key={c.campaignId} data-campaign={c.campaignId}>
                      <td><Link href={`/marketing/campaigns/${encodeURIComponent(c.campaignId)}`} className="row-link font-medium text-ink">{c.name}</Link></td>
                      <td className="text-right font-tabular">{inr(c.spendInr)}</td>
                      <td className="text-right font-tabular">{c.leads}</td>
                      <td className="text-right font-tabular">{money(c.costPerLead)}</td>
                      <td className="text-right font-tabular">{c.siteVisits}</td>
                      <td className="text-right font-tabular">{money(c.costPerSiteVisit)}</td>
                      <td className="text-right font-tabular">{c.bookings}</td>
                      <td className="text-right font-tabular font-semibold text-brand">{money(c.costPerBooking)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {report && report.channels.length > 0 && (
            <Card className="mt-4" title="Where enquiries came from">
              <table className="data-table">
                <thead><tr><th scope="col">Source</th><th scope="col" className="text-right">Spent</th><th scope="col" className="text-right">Enquiries</th><th scope="col" className="text-right">Site visits</th><th scope="col" className="text-right">Bookings</th><th scope="col" className="text-right">Cost per booking</th></tr></thead>
                <tbody>
                  {report.channels.map((c) => (
                    <tr key={c.channel}><td>{channelWord(c.channel)}</td><td className="text-right font-tabular">{inr(c.spendInr)}</td><td className="text-right font-tabular">{c.leads}</td><td className="text-right font-tabular">{c.siteVisits}</td><td className="text-right font-tabular">{c.bookings}</td><td className="text-right font-tabular">{money(c.costPerBooking)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {campaigns.length > 0 && (
            <Card className="mt-4" title="Add money spent" eyebrow="Enter what was spent on ads or promotions so the costs above stay right">
              <SpendForm campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} />
            </Card>
          )}
          <p className="mt-3 text-[12px] text-muted">A site visit counts once the buyer has actually visited. A booking counts once the sales team marks the buyer as booked.</p>
        </>
      )}
    </AppShell>
  );
}

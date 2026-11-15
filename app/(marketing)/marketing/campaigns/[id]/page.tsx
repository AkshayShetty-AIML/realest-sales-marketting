import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/auth";
import { premium } from "@/lib/premium/client";
import { marketing } from "@/lib/premium/marketing-client";
import { ARCHETYPE_LABEL, type Attribution } from "@/lib/premium/marketing-contract";
import { STAGE_LABEL, type LeadStage } from "@/lib/premium/contract";
import { archetypePreviews } from "@/lib/marketing/nurture";
import { JOB_WORD, MAGNET_DONE, channelWord, goalWord, sourceWord, toFriendly, whenWord } from "@/lib/marketing/labels";
import { store } from "@/lib/store";
import { inr } from "@/lib/grounding/facts";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Card, Stat } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { LeadActions } from "@/components/marketing/LeadActions";
import { BroadcastForm, SendBroadcastButton, SpendForm, TransitionControls } from "@/components/marketing/Controls";
import { ago } from "@/lib/time";
import { FirstReplyStats } from "@/components/marketing/FirstReplyStats";
import { replyStats } from "@/lib/automation/response-time";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n === null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const CONTACT = ["in_app", "email", "whatsapp", "sms"] as const;

/**
 * ONE CAMPAIGN — its results, the buyers it brought (the same buyers the
 * sales team sees under Leads), the messages sent to its buyer lists, money
 * spent, and the follow-ups each type of buyer gets.
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const rep = await requireRep();
  const { id } = await params;
  const campaign = (await marketing.listCampaigns({ limit: 200 })).find((c) => c.id === id);
  if (!campaign) notFound();
  const [spend, broadcasts, segments, report, leads, enrolments, previews, jobs, project, replyRows] = await Promise.all([
    marketing.listSpend({ campaignId: id }),
    marketing.listBroadcasts({ campaignId: id }),
    marketing.listSegments({ limit: 200 }),
    marketing.attribution({ campaignId: id }),
    marketing.listAttribution({ campaignId: id, limit: 500 }),
    marketing.listEnrolments({ campaignId: id }),
    archetypePreviews(),
    store().listJobs(),
    campaign.propertyId ? premium.getProperty(campaign.propertyId).catch(() => null) : Promise.resolve(null),
    store().listFirstReplies(),
  ]);
  const m = report.campaigns[0];
  const enrolledIds = new Set(enrolments.map((e) => e.leadId));
  const followUps = (lead: Attribution) => {
    const js = jobs.filter((j) => j.leadId === lead.leadId && (j.sequenceId ?? "").startsWith("seq-mkt-"));
    if (!js.length) return null;
    const counts = new Map<string, number>();
    for (const j of js) counts.set(JOB_WORD[j.status] ?? j.status, (counts.get(JOB_WORD[j.status] ?? j.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([w, n]) => `${n} ${w}`).join(" · ");
  };

  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing" wide>
      <PageHeader
        title={campaign.name}
        description={[project?.name, goalWord(campaign.objective), campaign.budgetInr !== null ? `Budget ${inr(campaign.budgetInr)}` : null].filter(Boolean).join(" · ")}
        actions={<><StatusBadge status={campaign.status} /><TransitionControls objectType="campaign" objectId={campaign.id} status={campaign.status} /></>}
      />
      <div className="grid grid-cols-5 gap-3">
        <Stat label="Spent" value={inr(m?.spendInr ?? 0)} />
        <Stat label="Enquiries" value={m?.leads ?? 0} tone="brand" hint={`${money(m?.costPerLead ?? null)} each`} />
        <Stat label="Site visits" value={m?.siteVisits ?? 0} hint={`${money(m?.costPerSiteVisit ?? null)} each`} />
        <Stat label="Bookings" value={m?.bookings ?? 0} tone="brand" />
        <Stat label="Cost per booking" value={money(m?.costPerBooking ?? null)} tone="brand" />
      </div>
      <FirstReplyStats stats={replyStats(replyRows.filter((r) => r.campaignId === id))} scope="this campaign's buyers" />

      <Card className="mt-4" title="Buyers from this campaign" eyebrow="Click a name to open the buyer in Sales → Leads">
        <table className="data-table">
          <thead><tr><th scope="col">Buyer</th><th scope="col">Found us through</th><th scope="col">What they asked for</th><th scope="col">OK to contact by</th><th scope="col">Type of buyer</th><th scope="col">Sales stage</th><th scope="col">Follow-up messages</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.leadId}>
                <td><Link href={`/leads/${encodeURIComponent(l.leadId)}`} className="row-link font-medium text-ink">{l.contactName ?? "Buyer"}</Link><div className="text-[12px] text-muted">{ago(l.createdAt)}</div></td>
                <td>{sourceWord(l.source)}{l.utm.source ? <div className="text-[12px] text-muted">{channelWord(l.utm.source)}</div> : null}</td>
                <td>{l.magnet ? MAGNET_DONE[l.magnet] ?? "—" : "—"}</td>
                <td className="text-[13px]">{l.consent ? CONTACT.filter((c) => l.consent?.[c]).map(channelWord).join(", ") || "Not given" : "—"}</td>
                <td>{l.archetype ? <Badge tone="brand">{ARCHETYPE_LABEL[l.archetype]}</Badge> : <span className="text-[13px] text-muted">Not known yet</span>}</td>
                <td>{STAGE_LABEL[l.stage as LeadStage] ?? l.stage}</td>
                <td className="text-[13px]">{followUps(l) ?? <span className="text-muted">Not started</span>}</td>
                <td><LeadActions campaignId={campaign.id} leadId={l.leadId} hasArchetype={!!l.archetype} enrolled={enrolledIds.has(l.leadId)} /></td>
              </tr>
            ))}
            {leads.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted">No enquiries yet. Share this campaign&apos;s project page to start collecting them.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="mt-4" title="Messages to buyer lists" eyebrow="Every message needs approval before it goes out. Only buyers who agreed to that channel receive it.">
        <ul className="divide-y divide-line">
          {broadcasts.map((b) => {
            const d = b.deliveries;
            return (
              <li key={b.id} className="flex items-start justify-between gap-6 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{b.name} <span className="font-normal text-muted">· {channelWord(b.channel)} to “{segments.find((s) => s.id === b.segmentId)?.name ?? "a list"}”</span></p>
                  {b.subject && <p className="text-[13px] text-ink">Subject: {b.subject}</p>}
                  <p className="mt-0.5 whitespace-pre-line text-[13px] text-body">{toFriendly(b.body)}</p>
                  {b.status === "published" && <p className="mt-1 text-[12px] text-muted">{[d.sent ? `${d.sent} sent` : null, d.pending_twilio ? `${d.pending_twilio} waiting for WhatsApp to be switched on` : null, d.failed ? `${d.failed} not sent` : null].filter(Boolean).join(" · ") || "Nobody to send to"}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5"><StatusBadge status={b.status} />{b.status === "approved" ? <SendBroadcastButton id={b.id} /> : <TransitionControls objectType="broadcast" objectId={b.id} status={b.status} />}</div>
              </li>
            );
          })}
          {broadcasts.length === 0 && <li className="py-4 text-[13px] text-muted">No messages yet.</li>}
        </ul>
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-[14px] font-semibold text-brand">Write a new message</summary>
          <div className="mt-3">{segments.length ? <BroadcastForm segments={segments.map((s) => ({ id: s.id, name: s.name }))} campaignId={campaign.id} /> : <p className="text-[13px] text-muted">Create a buyer list first (Buyer lists).</p>}</div>
        </details>
      </Card>

      <Card className="mt-4" title="Money spent">
        <ul className="mb-3 divide-y divide-line">
          {spend.map((s) => (
            <li key={s.id} className="flex justify-between py-2 text-[14px]"><span>{channelWord(s.channel)} <span className="text-muted">· {new Date(s.spentOn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{s.source === "builder_passthrough" ? " · paid by the builder" : ""}</span></span><span className="font-tabular text-ink">{inr(s.amountInr)}</span></li>
          ))}
          {spend.length === 0 && <li className="py-2 text-[13px] text-muted">Nothing entered yet.</li>}
        </ul>
        <SpendForm campaigns={[{ id: campaign.id, name: campaign.name }]} />
      </Card>

      <Card className="mt-4" title="Follow-up messages for each type of buyer" eyebrow="Sent automatically once you start follow-ups for a buyer. Shown here with a sample buyer, “Meera”.">
        <div className="grid grid-cols-5 gap-3">
          {previews.map((p) => (
            <div key={p.archetype} className="rounded-[10px] border border-line p-3">
              <p className="text-[14px] font-semibold text-ink">{p.label}</p>
              <ol className="mt-2 space-y-3">
                {p.steps.map((s, i) => (
                  <li key={i} className="text-[13px] leading-snug text-body">
                    <span className="text-[12px] font-semibold text-sage-ink">{whenWord(s.offsetHours)} · {channelWord(s.channel)}{s.channel === "whatsapp" ? " (once WhatsApp is on)" : ""}</span>
                    <p className="mt-0.5 whitespace-pre-line">{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}

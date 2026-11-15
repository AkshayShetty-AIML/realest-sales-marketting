import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { AuditEntry, Check, ObjectType, PublishStatus } from "@/lib/premium/marketing-contract";
import { CHECK_WORD, CONTENT_WORD, STATUS_WORD, activityWord, channelWord } from "@/lib/marketing/labels";
import { store } from "@/lib/store";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { Card } from "@/components/ui/Card";
import { SendBroadcastButton, TransitionControls } from "@/components/marketing/Controls";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

interface Item {
  type: ObjectType;
  id: string;
  title: string;
  kind: string;
  status: PublishStatus;
  href: string | null;
  channels?: string[];
}

/**
 * APPROVALS — nothing goes public or out to buyers until it's approved here.
 * Approving runs the RERA checklist automatically and explains anything that
 * needs fixing. Every step is kept in the activity list.
 */
export default async function ApprovalsPage() {
  const rep = await requireRep();
  let items: Item[] = [];
  let activity: AuditEntry[] = [];
  let checks = new Map<string, Check[]>();
  let people = new Map<string, string>();
  let error: string | null = null;
  try {
    const [content, pages, campaigns, broadcasts, log, reps] = await Promise.all([marketing.listContent({ limit: 200 }), marketing.listLandingPages({ limit: 200 }), marketing.listCampaigns({ limit: 200 }), marketing.listBroadcasts({ limit: 200 }), marketing.listAudit({ limit: 40 }), store().listReps()]);
    items = [
      ...campaigns.map((c): Item => ({ type: "campaign", id: c.id, title: c.name, kind: "Campaign", status: c.status, href: `/marketing/campaigns/${encodeURIComponent(c.id)}` })),
      ...pages.map((p): Item => ({ type: "landing_page", id: p.id, title: p.title, kind: "Project page", status: p.status, href: `/marketing/landing-pages/${encodeURIComponent(p.id)}` })),
      ...content.map((a): Item => ({ type: "content", id: a.id, title: a.title, kind: `${CONTENT_WORD[a.type] ?? "Post"}${a.channel ? ` for ${channelWord(a.channel)}` : ""}`, status: a.status, href: null, channels: a.publishChannels })),
      ...broadcasts.map((b): Item => ({ type: "broadcast", id: b.id, title: b.name, kind: `${channelWord(b.channel)} message`, status: b.status, href: b.campaignId ? `/marketing/campaigns/${encodeURIComponent(b.campaignId)}` : null })),
    ];
    activity = log;
    people = new Map(reps.map((r) => [r.id, r.name]));
    const waiting = items.filter((i) => i.status === "submitted");
    checks = new Map(await Promise.all(waiting.map(async (i) => [i.id, (await marketing.compliance(i.type, i.id)).checks] as const)));
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const by = (s: PublishStatus) => items.filter((i) => i.status === s);
  const titleOf = new Map(items.map((i) => [i.id, i.title]));
  const who = (actor: string) => people.get(actor) ?? (actor.includes("scheduler") ? "The scheduler" : "The system");
  const Title = ({ i }: { i: Item }) => (i.href ? <Link className="hover:underline" href={i.href}>{i.title}</Link> : <>{i.title}</>);

  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Approvals" description="Nothing is posted, published or sent to buyers until it's approved. When you approve, we check the RERA rules for you." />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <Card title={`Waiting for approval (${by("submitted").length})`}>
            <ul className="divide-y divide-line">
              {by("submitted").map((i) => {
                const list = checks.get(i.id) ?? [];
                const ready = list.every((c) => c.ok);
                return (
                  <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] gap-5 py-4">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-ink"><Title i={i} /></p>
                      <p className="text-[13px] text-muted">{i.kind}</p>
                    </div>
                    <div>
                      <p className={`text-[13px] font-semibold ${ready ? "text-trust-good" : "text-trust-risk"}`}>{ready ? "Ready to approve" : "Needs a fix before it can be approved"}</p>
                      <ul className="mt-1 space-y-0.5 text-[13px]">
                        {list.map((c) => <li key={c.rule} className={c.ok ? "text-body" : "text-trust-risk"}>{c.ok ? "✓" : "✗"} {CHECK_WORD[c.rule] ?? c.rule}{!c.ok && <span className="text-muted"> — {c.detail}</span>}</li>)}
                      </ul>
                    </div>
                    <TransitionControls objectType={i.type} objectId={i.id} status={i.status} channels={i.channels} />
                  </li>
                );
              })}
              {by("submitted").length === 0 && <li className="py-8 text-center text-[14px] text-muted">All caught up — nothing is waiting.</li>}
            </ul>
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {(["draft", "approved", "scheduled", "published"] as const).map((s) => (
              <Card key={s} title={`${STATUS_WORD[s]} (${by(s).length})`}>
                <ul className="max-h-[340px] divide-y divide-line overflow-auto">
                  {by(s).map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-ink"><Title i={i} /></p>
                        <p className="text-[12px] text-muted">{i.kind}</p>
                      </div>
                      {i.type === "broadcast" && s === "approved" ? <SendBroadcastButton id={i.id} /> : <TransitionControls objectType={i.type} objectId={i.id} status={i.status} channels={i.channels} />}
                    </li>
                  ))}
                  {by(s).length === 0 && <li className="py-3 text-[13px] text-muted">None.</li>}
                </ul>
              </Card>
            ))}
          </div>

          <Card className="mt-4" title="Activity" eyebrow="Who approved, sent or changed what, and when">
            <ol className="space-y-2.5 border-l border-line pl-4">
              {activity.map((a) => (
                <li key={a.id} className="relative">
                  <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${a.ok ? "bg-forest" : "bg-rust"}`} />
                  <p className="text-[14px] text-ink">
                    <span className="font-medium">{who(a.actor)}</span> {activityWord(a.action)} “{titleOf.get(a.objectId) ?? "an item"}”
                    <span className="text-muted"> · {ago(a.at)}</span>
                  </p>
                  {!a.ok && a.checks && <p className="text-[12px] text-trust-risk">{a.checks.filter((c) => !c.ok).map((c) => CHECK_WORD[c.rule] ?? c.rule).join(" · ")} — not met</p>}
                </li>
              ))}
              {activity.length === 0 && <li className="text-[13px] text-muted">Nothing yet.</li>}
            </ol>
          </Card>
        </>
      )}
    </AppShell>
  );
}

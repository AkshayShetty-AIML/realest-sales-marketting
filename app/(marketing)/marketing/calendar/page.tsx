import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { ContentAsset } from "@/lib/premium/marketing-contract";
import { CONTENT_WORD, channelWord } from "@/lib/marketing/labels";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { PublishDueButton, ScheduleForm, TransitionControls } from "@/components/marketing/Controls";
import { formatIst } from "@/lib/scheduling/time";

export const dynamic = "force-dynamic";

/**
 * CONTENT CALENDAR — schedule approved posts to Instagram / Facebook /
 * LinkedIn / YouTube from one place. Publishing is STUBBED (no social API):
 * when a post's time comes it moves to published and a publication is
 * recorded per channel with no external post id.
 */
export default async function CalendarPage() {
  const rep = await requireRep();
  let content: ContentAsset[] = [];
  let pubs: Awaited<ReturnType<typeof marketing.listPublications>> = [];
  let error: string | null = null;
  try {
    [content, pubs] = await Promise.all([marketing.listContent({ limit: 200 }), marketing.listPublications({ limit: 500 })]);
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const approved = content.filter((c) => c.status === "approved");
  const onCalendar = content.filter((c) => c.status === "scheduled" || c.status === "published").sort((a, b) => (a.scheduledAt ?? a.publishedAt ?? "").localeCompare(b.scheduledAt ?? b.publishedAt ?? ""));
  const days = new Map<string, ContentAsset[]>();
  for (const c of onCalendar) {
    const key = formatIst(c.scheduledAt ?? c.publishedAt ?? c.createdAt, "day");
    days.set(key, [...(days.get(key) ?? []), c]);
  }
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing" wide>
      <PageHeader title="Post calendar" description="Choose when and where each approved post goes out. Automatic posting to Instagram, Facebook, LinkedIn and YouTube isn't connected yet — at the set time the post is marked published so your team can post it." actions={<PublishDueButton />} />
      {error !== null ? <Problem detail={error} /> : (
        <div className="grid grid-cols-[1.3fr_1fr] gap-3">
          <Card title="Coming up and already out">
            {Array.from(days.entries()).map(([day, list]) => (
              <section key={day} className="border-b border-line py-3 last:border-0">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{day}</h3>
                <ul className="mt-2 space-y-2">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 rounded-[10px] border border-line p-3">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-ink">{c.title}</p>
                        <p className="text-[12px] text-muted">{CONTENT_WORD[c.type] ?? "Post"}{c.scheduledAt ? ` · at ${formatIst(c.scheduledAt, "time")}` : ""}{c.publishedAt ? ` · published ${formatIst(c.publishedAt, "time")}` : ""}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(c.publishChannels ?? []).map((ch) => {
                            const p = pubs.find((x) => x.assetId === c.id && x.channel === ch);
                            return <Badge key={ch} tone={p ? "good" : "outline"} dot={false}>{channelWord(ch)}{p ? " · marked published" : ""}</Badge>;
                          })}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5"><StatusBadge status={c.status} /><TransitionControls objectType="content" objectId={c.id} status={c.status} channels={c.publishChannels} /></div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {onCalendar.length === 0 && <p className="py-6 text-center text-[13px] text-muted">Nothing scheduled yet — pick an approved post on the right.</p>}
          </Card>
          <Card title={`Ready to schedule (${approved.length})`}>
            <ul className="divide-y divide-line">
              {approved.map((c) => (
                <li key={c.id} className="space-y-2 py-3">
                  <p className="text-[14px] font-medium text-ink">{c.title} <span className="text-[12px] font-normal text-muted">· {CONTENT_WORD[c.type] ?? "Post"}</span></p>
                  <ScheduleForm assetId={c.id} />
                </li>
              ))}
              {approved.length === 0 && <li className="py-6 text-center text-[13px] text-muted">Posts appear here once they&apos;re approved.</li>}
            </ul>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

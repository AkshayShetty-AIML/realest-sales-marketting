import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { BrandKit, ContentAsset, MediaItem } from "@/lib/premium/marketing-contract";
import { listBuildings, type Building } from "@/lib/marketing/data";
import { CONTENT_WORD, channelWord } from "@/lib/marketing/labels";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/marketing/StatusBadge";
import { ContentStudio } from "@/components/marketing/ContentStudio";
import { TransitionControls } from "@/components/marketing/Controls";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

/** CREATE POSTS — pick a project, get posts written from its verified details, edit, save, send for approval. */
export default async function ContentStudioPage() {
  const rep = await requireRep();
  let buildings: Building[] = [];
  let kit: BrandKit | null = null;
  let recent: ContentAsset[] = [];
  let media: MediaItem[] = [];
  let error: string | null = null;
  try {
    [buildings, kit, recent, media] = await Promise.all([listBuildings(), marketing.getBrandKit(), marketing.listContent({ limit: 20 }), marketing.listMedia({ limit: 12 })]);
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  const posts = recent.filter((c) => c.type !== "video");
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing" wide>
      <PageHeader title="Create posts" description="Choose a project and we'll write posts, captions and ads from its verified details. Edit them, save, and send them for approval." />
      {error !== null ? <Problem detail={error} /> : (
        <>
          <ContentStudio buildings={buildings} reraRegNo={kit?.defaultReraRegNo ?? null} brand={kit ? { primaryColor: kit.primaryColor, headingFont: kit.headingFont, builderName: kit.builderName } : null} />
          <div className="mt-4 grid grid-cols-[1.5fr_1fr] gap-3">
            <Card title="Your posts">
              <ul className="divide-y divide-line">
                {posts.map((c) => (
                  <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-ink">{c.title}</span>
                      <span className="block truncate text-[12px] text-muted">{CONTENT_WORD[c.type] ?? c.type}{c.channel ? ` for ${channelWord(c.channel)}` : ""} · {ago(c.createdAt)}{c.aiGenerated ? " · AI-written" : ""}</span>
                    </span>
                    <span className="flex items-center gap-2"><StatusBadge status={c.status} />{c.status === "draft" && <TransitionControls objectType="content" objectId={c.id} status={c.status} />}</span>
                  </li>
                ))}
                {posts.length === 0 && <li className="py-6 text-center text-[13px] text-muted">Nothing saved yet.</li>}
              </ul>
            </Card>
            <Card title="Videos" eyebrow="Automatic video making is coming soon — requested videos wait here">
              <ul className="divide-y divide-line">
                {media.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <span aria-hidden className="flex h-12 w-9 shrink-0 items-center justify-center rounded-[6px] bg-surface-alt text-[10px] text-muted">▶</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{m.label.replace(/ — processing \(demo\)$/, "").replace(/^Reel — /, "Short video — ")}</span>
                      <span className="block text-[12px] text-muted">{ago(m.createdAt)}{m.aiGenerated ? " · AI-made" : ""}</span>
                    </span>
                    <Badge tone={m.status === "processing" ? "caution" : m.status === "ready" ? "good" : "risk"}>{m.status === "processing" ? "Not made yet" : m.status === "ready" ? "Ready" : "Failed"}</Badge>
                  </li>
                ))}
                {media.length === 0 && <li className="py-6 text-center text-[13px] text-muted">No videos yet.</li>}
              </ul>
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}

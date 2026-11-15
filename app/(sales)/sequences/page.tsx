import Link from "next/link";
import { requireRep } from "@/lib/auth";
import { store } from "@/lib/store";
import { navCounts } from "@/lib/inbox-data";
import { TRIGGER_LABEL, OBJECTION_LABEL } from "@/lib/automation/sequences";
import type { Sequence } from "@/lib/store/types";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Card } from "@/components/ui/Card";
import { buttonClass } from "@/components/ui/Button";
import { SequenceEditor } from "@/components/SequenceEditor";
import { SequenceToggle } from "@/components/SequenceToggle";
import { MessagePreview } from "@/components/MessagePreview";
import { ChatIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

const CHANNEL = { in_app: "In-app", whatsapp: "WhatsApp", email: "Email", sms: "SMS" } as const;
const initials = (name: string) => name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** When the steps go out, in plain words: "Day 0, Day 1, Day 3" or "1 day before". */
function timing(s: Sequence): string {
  const rel = s.trigger === "visit_booked";
  const label = (h: number) => {
    if (rel) return h < 0 ? (h <= -24 ? `${Math.round(-h / 24)} day before` : `${-h} h before`) : `${h} h after`;
    if (h === 0) return "Right away";
    if (h < 24) return `After ${h} h`;
    return `Day ${Math.round(h / 24)}`;
  };
  const when = Array.from(new Set(s.steps.map((x) => label(x.offsetHours)))).join(", ");
  const start = s.params.afterHours ? `After ${s.params.afterHours} h of silence` : s.params.afterDays ? `After ${s.params.afterDays} days of silence` : null;
  return [start ?? when, Array.from(new Set(s.steps.map((x) => CHANNEL[x.channel]))).join(", ")].join(" · ");
}

/** FOLLOW-UP SEQUENCES — what goes out automatically, shown as the buyer reads it. */
export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const rep = await requireRep();
  const { edit } = await searchParams;
  const [sequences, runs, counts] = await Promise.all([store().listSequences(), store().listRuns(), navCounts()]);
  const editing = edit === "new" ? null : sequences.find((s) => s.id === edit);

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts}>
      <PageHeader
        title="Follow-up sequences"
        description="Automatic messages sent on a delay after something happens. They stop when the buyer replies, books, or you take over."
        actions={<Link href="/sequences?edit=new" className={buttonClass({ size: "sm" })}>+ New sequence</Link>}
      />

      {(edit === "new" || editing) && (
        <Card title={editing ? `Edit: ${editing.name}` : "New sequence"} className="mb-5" action={<Link href="/sequences" className={buttonClass({ variant: "ghost", size: "sm" })}>Close</Link>}>
          <SequenceEditor key={editing?.id ?? "new"} initial={editing ?? null} />
        </Card>
      )}

      <section className="card divide-y divide-line overflow-hidden">
        {sequences.map((s) => {
          const running = runs.filter((r) => r.sequenceId === s.id && r.status === "active").length;
          return (
            <div key={s.id} className="grid grid-cols-[2.75rem_minmax(0,1.1fr)_minmax(0,1.6fr)_auto] items-center gap-4 px-5 py-3.5 hover:bg-brand-mist/60">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold text-white ${s.active ? "bg-forest" : "bg-sage"}`}>{initials(s.name)}</span>
              <div className="min-w-0">
                <Link href={`/sequences?edit=${s.id}`} className="block truncate text-[15px] font-medium text-ink hover:text-brand">{s.name}</Link>
                <p className="truncate text-[12px] text-muted">{timing(s)}</p>
                <p className="truncate text-[12px] text-muted">{TRIGGER_LABEL[s.trigger]}{s.params.objection ? ` · ${OBJECTION_LABEL[s.params.objection]}` : ""}{running ? ` · ${running} running` : ""}</p>
              </div>
              <p className="flex min-w-0 items-start gap-2 rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] leading-snug text-body shadow-control">
                <ChatIcon size={15} className="mt-0.5 shrink-0 text-muted" />
                <MessagePreview template={s.steps[0]?.template ?? ""} className="line-clamp-2" />
              </p>
              <SequenceToggle id={s.id} active={s.active} name={s.name} />
            </div>
          );
        })}
        {sequences.length === 0 && <p className="px-5 py-10 text-center text-muted">No sequences yet. Create one to follow up automatically.</p>}
      </section>
      <p className="mt-3 text-[12px] text-muted">Previews use example details (Meera, Cedar Heights). Real messages use each buyer&apos;s own details. WhatsApp, SMS and email steps wait until those channels are set up; in-app steps go out now.</p>
    </AppShell>
  );
}

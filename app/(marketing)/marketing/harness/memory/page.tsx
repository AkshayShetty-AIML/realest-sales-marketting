import Link from "next/link";
import { Suspense } from "react";
import { requireRep } from "@/lib/auth";
import { memoryFor, myWorkspace, myWorkspaces } from "@/lib/marketing/console/read";
import { PageHeader } from "@/app/_shell/AppShell";
import { WorkspacePicker } from "@/components/harness/Nav";
import { DemoBadge } from "@/components/ui/Badge";
import { Empty, Marker } from "@/components/harness/Parts";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

/** MEMORY — one workspace's company memory, by kind, with the same retrieval the agents use. */
export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ ws?: string; kind?: string; q?: string }> }) {
  const rep = await requireRep();
  const { ws, kind, q } = await searchParams;
  const spaces = await myWorkspaces(rep.repId);
  const current = (await myWorkspace(rep.repId, ws)) ?? spaces[0] ?? null;
  const picker = <Suspense><WorkspacePicker options={spaces.map((s) => ({ id: s.id, name: s.name }))} current={current?.id ?? null} /></Suspense>;
  if (!current) return <><PageHeader title="Memory" />{<Empty title="No workspaces yet" />}</>;
  const { kinds, items, total } = await memoryFor(current, kind, q?.trim() || undefined);
  const link = (k?: string) => `/marketing/harness/memory?${new URLSearchParams({ ws: current.id, ...(k ? { kind: k } : {}) })}`;
  return (
    <>
      <PageHeader title="Memory" description={`${current.name}'s company memory — brand kit, projects, audiences, campaigns, leads, decisions, learnings and what the agents produced. Only this workspace can read it.`} actions={picker} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Link href={link()} className={`rounded-full px-3 py-1.5 text-[13px] ${!kind ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>All {total}</Link>
        {kinds.map(([k, n]) => <Link key={k} href={link(k)} className={`rounded-full px-3 py-1.5 text-[13px] ${kind === k ? "bg-mint-light font-semibold text-brand" : "text-body hover:bg-surface-alt"}`}>{k.replace(/_/g, " ")} <span className="font-tabular">{n}</span></Link>)}
        <form className="ml-auto flex gap-2" action="/marketing/harness/memory">
          <input type="hidden" name="ws" value={current.id} />
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input className="control h-9 w-64" name="q" defaultValue={q ?? ""} placeholder="Search memory (agent retrieval)" />
        </form>
      </div>
      {total === 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-dashed border-line-strong bg-surface-alt/60 px-4 py-3"><p className="flex-1 text-[13px] text-body">The agents ground everything on this memory — a brand kit with the RERA number and at least one project. To try it with sample data, run <code>npm run demo:seed</code>.</p></div>}
      {items.length === 0 ? <Empty title={q ? "Nothing matches" : "Nothing stored yet"} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((i) => (
            <article key={i.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-mint-light px-2 py-0.5 text-[11px] font-semibold text-brand">{i.kind.replace(/_/g, " ")}</span>
                {i.demo && <DemoBadge />}
                {i.trust === "untrusted" && <Marker tone="tainted">Untrusted (third-party)</Marker>}
                <span className="font-mono text-[11px] text-muted">{i.key}</span>
                <span className="ml-auto text-[11px] text-muted">{ago(i.updatedAt)} · {i.source.replace(/^operator:/, "")}</span>
              </div>
              <h3 className="mt-2 text-[15px] font-semibold text-ink">{i.title}</h3>
              {i.text && i.text !== i.title && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13px] text-body">{i.text}</p>}
              {Object.keys(i.data).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-brand">Data</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-[8px] bg-surface-alt p-2 text-[11px] text-body">{JSON.stringify(i.data, null, 2)}</pre>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

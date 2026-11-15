"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * THE HARNESS'S TOP TAB BAR — its sections live here, inside the main
 * content area. The app's one left panel stays the only sidebar; "Agent
 * Harness" is a single item in it. The selected workspace (?ws=) carries
 * across tabs.
 */
const TABS = [
  { href: "/marketing/harness", label: "Operations", exact: true },
  { href: "/marketing/harness/missions", label: "Missions" },
  { href: "/marketing/harness/approvals", label: "Approvals", count: true },
  { href: "/marketing/harness/automations", label: "Automations" },
  { href: "/marketing/harness/memory", label: "Memory" },
  { href: "/marketing/harness/audit", label: "Audit" },
  { href: "/marketing/harness/settings", label: "Settings" },
];

export function HarnessTabs({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const ws = params.get("ws");
  return (
    <nav aria-label="Agent harness" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={ws ? `${t.href}?ws=${encodeURIComponent(ws)}` : t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 text-[14px] font-medium transition-colors ${active ? "border-brand text-brand" : "border-transparent text-body hover:text-ink"}`}
          >
            {t.label}
            {t.count && pendingApprovals > 0 && <span className="rounded-full bg-ochre px-1.5 py-0.5 font-tabular text-[11px] font-semibold leading-none text-white">{pendingApprovals}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Which workspace a tab shows. Only the operator's own workspaces are offered (the server already filtered them). */
export function WorkspacePicker({ options, current, allowAll = false }: { options: { id: string; name: string }[]; current: string | null; allowAll?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label="Workspace"
      className="control h-10 w-60"
      value={current ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("ws", e.target.value);
        else next.delete("ws");
        for (const k of ["kind", "q", "task", "agent"]) next.delete(k);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      {allowAll && <option value="">All workspaces</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

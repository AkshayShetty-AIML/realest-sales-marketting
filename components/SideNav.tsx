"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AgentsIcon, BoardIcon, BriefcaseIcon, BuildingIcon, CalendarIcon, DocIcon, ShieldIcon, GaugeIcon, InboxIcon, LogoMark, SendIcon, SettingsIcon, SparkIcon, StarIcon, UsersIcon, WandIcon } from "./icons";

/** The two workspaces of the one app. Each shows only its own nav. */
export type Workspace = "sales" | "marketing";

/** The desk's left nav (asset sheet): dark forest rail, labelled items, live count on Leads. */
export interface NavCounts {
  inbox: number;
  needsRep: number;
}

const items = [
  { href: "/dashboard", label: "Dashboard", Icon: GaugeIcon, match: ["/dashboard"], count: null },
  { href: "/inbox", label: "Leads", Icon: InboxIcon, match: ["/inbox", "/leads"], count: "inbox" as const },
  { href: "/pipeline", label: "Pipeline", Icon: BoardIcon, match: ["/pipeline"], count: null },
  { href: "/visits", label: "Visits", Icon: CalendarIcon, match: ["/visits"], count: null },
  { href: "/inventory", label: "Inventory", Icon: BuildingIcon, match: ["/inventory"], count: null },
  { href: "/sequences", label: "Sequences", Icon: SparkIcon, match: ["/sequences"], count: null },
  { href: "/reps", label: "Reps & routing", Icon: UsersIcon, match: ["/reps"], count: null },
];

function NavLink({ href, label, Icon, active, n }: { href: string; label: string; Icon: typeof GaugeIcon; active: boolean; n?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${
        active ? "bg-rail-active text-rail-bg shadow-control" : "text-rail-ink hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      {n ? <span className={`rounded-full px-2 py-0.5 font-tabular text-[12px] font-semibold ${active ? "bg-brand text-white" : "bg-white/15 text-white"}`}>{n}</span> : null}
    </Link>
  );
}

export function SideNav({ counts }: { counts: NavCounts | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ href, label, Icon, match, count }) => (
        <NavLink key={href} href={href} label={label} Icon={Icon} active={match.some((m) => pathname.startsWith(m))} n={count && counts ? counts[count] : 0} />
      ))}
    </nav>
  );
}

/** Builder services — in both workspaces' rail, above Settings. */
export function ServicesLink({ workspace }: { workspace: Workspace }) {
  const pathname = usePathname();
  return <NavLink href={`/services?ws=${workspace}`} label="Services" Icon={BriefcaseIcon} active={pathname.startsWith("/services")} />;
}

/** Settings sits at the bottom of the rail — integrations are not a rep's daily work. */
export function SettingsLink() {
  const pathname = usePathname();
  return <NavLink href="/status" label="Settings" Icon={SettingsIcon} active={pathname.startsWith("/status")} />;
}

/** Marketing workspace nav — plain words, for the builder's own team. */
const marketingItems = [
  { href: "/marketing/dashboard", label: "Overview", Icon: GaugeIcon },
  { href: "/marketing/campaigns", label: "Campaigns", Icon: SendIcon },
  { href: "/marketing/content", label: "Create posts", Icon: WandIcon },
  { href: "/marketing/calendar", label: "Post calendar", Icon: CalendarIcon },
  { href: "/marketing/approvals", label: "Approvals", Icon: ShieldIcon },
  { href: "/marketing/landing-pages", label: "Project pages", Icon: DocIcon },
  { href: "/marketing/audiences", label: "Buyer lists", Icon: UsersIcon },
  { href: "/marketing/brand-kit", label: "Brand settings", Icon: StarIcon },
  // The agent harness is a destination in this same nav — its sections are a top tab bar, not a second sidebar.
  { href: "/marketing/harness", label: "Agent Harness", Icon: AgentsIcon },
];

export function MarketingNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Marketing" className="flex flex-col gap-1">
      {marketingItems.map(({ href, label, Icon }) => (
        <NavLink key={href} href={href} label={label} Icon={Icon} active={pathname.startsWith(href)} />
      ))}
    </nav>
  );
}

/** Top-left switch between the two workspaces. Plain links: each lands on that workspace's dashboard. */
export function WorkspaceSwitcher({ workspace }: { workspace: Workspace }) {
  const tabs: { value: Workspace; label: string; href: string }[] = [
    { value: "marketing", label: "Marketing", href: "/marketing/dashboard" },
    { value: "sales", label: "Sales", href: "/dashboard" },
  ];
  return (
    <nav aria-label="Workspace" className="grid grid-cols-2 gap-1 rounded-[10px] bg-white/10 p-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          aria-current={workspace === t.value ? "page" : undefined}
          className={`flex h-8 items-center justify-center rounded-[7px] text-[13px] font-medium transition-colors ${
            workspace === t.value ? "bg-rail-active text-rail-bg shadow-control" : "text-rail-ink hover:bg-white/10 hover:text-white"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Brand({ workspace = "sales" }: { workspace?: Workspace }) {
  const marketing = workspace === "marketing";
  return (
    <Link href={marketing ? "/marketing/dashboard" : "/dashboard"} className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-brand text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
        <LogoMark size={19} />
      </span>
      <span>
        <span className="block font-display text-[19px] leading-none text-white">{marketing ? "Marketing" : "Sales desk"}</span>
        <span className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-rail-muted">{marketing ? "Builder marketing" : "Builder sales"}</span>
      </span>
    </Link>
  );
}

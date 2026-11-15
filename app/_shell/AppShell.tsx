import type { ReactNode } from "react";
import { Brand, MarketingNav, ServicesLink, SettingsLink, SideNav, WorkspaceSwitcher, type NavCounts, type Workspace } from "@/components/SideNav";
import { UserMenu } from "@/components/UserMenu";

/**
 * The desk frame (asset sheet): dark-forest rail — brand, the workspace
 * switch (Marketing | Sales), that workspace's nav, Settings at the bottom
 * (Sales), the signed-in user — and the content column on the warm canvas.
 * `fit` makes the content exactly one viewport tall (the dashboard and the
 * two-pane lead page scroll inside their panes, never the page).
 */
export function AppShell({ rep, demo, counts, children, wide = false, fit = false, workspace = "sales" }: { rep: string; demo: boolean; counts?: NavCounts | null; children: ReactNode; wide?: boolean; fit?: boolean; workspace?: Workspace }) {
  const marketing = workspace === "marketing";
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="sticky top-0 flex h-dvh w-[232px] shrink-0 flex-col bg-rail-bg px-3.5 py-5 text-rail-ink">
        <div className="px-1.5"><Brand workspace={workspace} /></div>
        <div className="mt-5"><WorkspaceSwitcher workspace={workspace} /></div>
        <div className="mt-5 flex-1">{marketing ? <MarketingNav /> : <SideNav counts={counts ?? null} />}</div>
        <ServicesLink workspace={workspace} />
        {!marketing && <SettingsLink />}
        <div className="mt-3"><UserMenu name={rep.replace(/ \(demo.*\)$/, "")} role={marketing ? (demo ? "Marketing · demo" : "Marketing") : demo ? "Sales rep · demo" : "Sales rep"} dark /></div>
      </aside>
      <main className={`min-w-0 flex-1 ${fit ? "flex h-dvh flex-col overflow-hidden px-8 py-6" : "px-8 py-7"} ${wide || fit ? "" : "mx-auto max-w-[1400px]"}`}>{children}</main>
    </div>
  );
}

export { PageHeader } from "@/components/Shell";

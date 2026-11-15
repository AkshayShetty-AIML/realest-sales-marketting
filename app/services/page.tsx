import { requireRep } from "@/lib/auth";
import { store } from "@/lib/store";
import { navCounts } from "@/lib/inbox-data";
import { FOR_BUYERS, FOR_DEVELOPERS, type BuilderService } from "@/lib/services/catalog";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Badge } from "@/components/ui/Badge";
import { InterestButton } from "@/components/ServiceInterest";

export const dynamic = "force-dynamic";

/** SERVICES (OPS-29) — what is coming for a developer's buyers and for the developer. Nothing is live: each one only records "tell me when it's ready". */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const rep = await requireRep();
  const workspace = (await searchParams).ws === "marketing" ? "marketing" : "sales";
  const [interests, counts] = await Promise.all([store().listServiceInterests(), workspace === "sales" ? navCounts() : Promise.resolve(null)]);
  const asked = new Set(interests.filter((i) => i.repId === rep.repId).map((i) => i.service));
  const section = (title: string, description: string, services: BuilderService[]) => (
    <section className="mb-8">
      <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-[13px] text-body">{description}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {services.map((s) => (
          <article key={s.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">{s.title}</h3>
              <Badge tone="neutral">Coming soon</Badge>
            </div>
            <p className="mt-1.5 flex-1 text-[13px] text-body">{s.what}</p>
            <div className="mt-3"><InterestButton service={s.id} asked={asked.has(s.id)} /></div>
          </article>
        ))}
      </div>
    </section>
  );
  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} workspace={workspace}>
      <PageHeader title="Services" description="Services we're building for your buyers and for you. None is available yet — tell us which ones you want and we'll let you know when they're ready." />
      {section("For your buyers", "Help your buyers get from booking to moving in.", FOR_BUYERS)}
      {section("For you", "Help with bookings, collections, finance and selling.", FOR_DEVELOPERS)}
    </AppShell>
  );
}

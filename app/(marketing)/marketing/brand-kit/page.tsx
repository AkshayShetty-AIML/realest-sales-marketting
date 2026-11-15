import { requireRep } from "@/lib/auth";
import { marketing } from "@/lib/premium/marketing-client";
import type { BrandKit } from "@/lib/premium/marketing-contract";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Problem } from "@/components/marketing/Problem";
import { BrandKitForm } from "@/components/marketing/BrandKitForm";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";

/** BRAND KIT — the one kit (single-tenant) every generated asset is written on. Stored on the spine. */
export default async function BrandKitPage() {
  const rep = await requireRep();
  let kit: BrandKit | null = null;
  let error: string | null = null;
  try {
    kit = await marketing.getBrandKit();
  } catch (e) {
    error = e instanceof Error ? e.message : "";
  }
  return (
    <AppShell rep={rep.name} demo={rep.demo} workspace="marketing">
      <PageHeader title="Brand settings" description={kit ? `Your logo, colours, fonts and RERA number — used on every post and page. Last saved ${ago(kit.updatedAt)}.` : "Add your logo, colours and RERA number. Posts and pages can't be made until the RERA number is added."} />
      {error !== null ? <Problem detail={error} /> : <BrandKitForm initial={kit} />}
    </AppShell>
  );
}

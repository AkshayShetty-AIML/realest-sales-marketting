import { notFound } from "next/navigation";
import { marketing } from "@/lib/premium/marketing-client";
import { MAGNETS } from "@/lib/premium/marketing-contract";
import { CONSENT_TEXT } from "@/lib/marketing/capture";
import { loadProjectPage } from "@/lib/marketing/project-page";
import { ProjectPage } from "@/components/marketing/project/ProjectPage";
import { CaptureForm } from "@/components/marketing/CaptureForm";

/**
 * /b/lp/<slug> — the PUBLIC project page. Served only once PUBLISHED (the
 * approval gate); drafts, submitted and approved pages 404. Every fact on it
 * is read live from the shared inventory; UTM parameters ride into the lead.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function PublicLanding({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) notFound();
  const page = await marketing.findLandingPage(slug).catch(() => null);
  if (!page || page.status !== "published") notFound();
  const model = await loadProjectPage(page);
  if (!model) notFound();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 100) : undefined);
  return (
    <ProjectPage
      model={model}
      enquiry={<CaptureForm pageId={page.id} magnets={[...MAGNETS]} accent={model.brand.primary} consentText={CONSENT_TEXT} utm={{ source: one("utm_source"), medium: one("utm_medium"), campaign: one("utm_campaign"), content: one("utm_content"), term: one("utm_term") }} />}
    />
  );
}

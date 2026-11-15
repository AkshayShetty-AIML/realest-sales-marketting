"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generateLandingAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";

/** Pick a building (+ optional campaign) → generate a draft landing page → open its preview. */
export function LandingBuilder({ buildings, campaigns, ready }: { buildings: { id: string; name: string; locality: string }[]; campaigns: { id: string; name: string; propertyId: string | null }[]; ready: boolean }) {
  const [propertyId, setPropertyId] = useState(buildings[0]?.id ?? "");
  const [campaignId, setCampaignId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = () =>
    start(async () => {
      const r = await generateLandingAction(propertyId, campaignId || undefined);
      if (r.ok && r.data) router.push(`/marketing/landing-pages/${encodeURIComponent(r.data.id)}`);
      else if (!r.ok) setError(r.error);
    });
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-4 px-5 py-4">
      <Field label="Project" className="min-w-[240px]">
        <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.locality}</option>)}</Select>
      </Field>
      <Field label="For campaign (optional)" className="min-w-[260px]">
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">No campaign</option>
          {campaigns.filter((c) => !c.propertyId || c.propertyId === propertyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Button disabled={pending || !ready || !propertyId} onClick={go}>{pending ? "Making the page…" : "Make page"}</Button>
      {!ready && <p className="text-[13px] text-trust-caution">Add your RERA number in Brand settings first.</p>}
      {error && <p role="alert" className="text-[13px] text-trust-risk">{error}</p>}
    </div>
  );
}

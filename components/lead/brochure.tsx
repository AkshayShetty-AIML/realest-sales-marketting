"use client";

import { generateBrochureAction, sendBrochureAction } from "@/app/actions";
import { Button, buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DocIcon, DownloadIcon, SendIcon, SparkIcon } from "@/components/icons";
import { useAction } from "./controls";

/** Lead page → Brochure card: generate a personalised PDF, download it, send it (in_app live; WhatsApp/email queued). */
export interface BrochureView {
  id: string;
  createdAt: string;
  createdLabel: string;
  engine: "llm" | "template";
  fallbackReason: string | null;
  deliveries: { channel: string; status: string; atLabel: string }[];
}

const CHANNEL: Record<string, string> = { in_app: "In-app", whatsapp: "WhatsApp", email: "Email" };

export function GenerateBrochure({ leadId }: { leadId: string }) {
  const { pending, go, feedback } = useAction();
  return (
    <div>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(() => generateBrochureAction(leadId))}>
        <SparkIcon size={15} /> {pending ? "Making…" : "Make brochure"}
      </Button>
      {feedback}
    </div>
  );
}

export function BrochureItem({ leadId, b, latest }: { leadId: string; b: BrochureView; latest: boolean }) {
  const { pending, go, feedback } = useAction();
  const send = (channel: string) => go(() => sendBrochureAction(leadId, b.id, channel));
  return (
    <li className={latest ? "" : "opacity-80"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-medium text-ink"><DocIcon size={15} /> Brochure · {b.createdLabel}</p>
          <p className="mt-0.5 text-[12px] text-muted" title={b.fallbackReason ?? undefined}>
            {b.engine === "llm" ? "Written by AI from the property facts" : "Written from the property facts"}
          </p>
        </div>
        <a href={`/api/brochures/${b.id}`} target="_blank" rel="noopener" className={buttonClass({ variant: "ghost", size: "sm" })}>
          <DownloadIcon size={15} /> PDF
        </a>
      </div>
      {latest && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="!h-8" disabled={pending} onClick={() => send("in_app")}><SendIcon size={14} /> Send to buyer</Button>
          <button type="button" disabled={pending} onClick={() => send("whatsapp")} className="h-8 rounded-control px-2 text-[12px] font-medium text-brand hover:bg-brand-mist disabled:opacity-40" title="Saved and sent once WhatsApp is set up">Save for WhatsApp</button>
          <button type="button" disabled={pending} onClick={() => send("email")} className="h-8 rounded-control px-2 text-[12px] font-medium text-brand hover:bg-brand-mist disabled:opacity-40" title="Saved and sent once email is set up">Save for email</button>
        </div>
      )}
      {b.deliveries.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {b.deliveries.map((d, i) => (
            <li key={i}>
              <Badge tone={d.status === "sent" ? "good" : d.status === "pending_twilio" ? "caution" : "risk"}>
                {CHANNEL[d.channel] ?? d.channel} · {d.status === "sent" ? "sent" : d.status === "pending_twilio" ? "pending setup" : "failed"} · {d.atLabel}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {feedback}
    </li>
  );
}

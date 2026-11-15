import { requireRep } from "@/lib/auth";
import { premium } from "@/lib/premium/client";
import { store } from "@/lib/store";
import { authConfigured, llmConfig, premiumConfig, premiumRealtimeConfig, salesSupabaseConfig, twilioConfig, whatsappPaused } from "@/lib/env";
import { feedStatus } from "@/lib/automation/realtime";
import { inboundPollStatus } from "@/lib/whatsapp/inbound-poll";
import { navCounts } from "@/lib/inbox-data";
import { maskE164, toE164 } from "@/lib/whatsapp/phone";
import { AppShell, PageHeader } from "@/app/_shell/AppShell";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { when } from "@/lib/time";
import { visitSettings } from "@/lib/automation/visits";
import { VisitSettingsForm } from "@/components/VisitSettingsForm";

export const dynamic = "force-dynamic";

type Row = { name: string; state: string; tone: BadgeTone; detail: string; extra?: string[] };

/** CONNECTIONS — the real state of every integration. Never shows a key. */
export default async function StatusPage() {
  const rep = await requireRep();
  const premiumCfg = premiumConfig();
  let premiumState = { state: "not configured", tone: "risk" as BadgeTone, detail: "Set PREMIUM_API_BASE and SALES_INTERNAL_API_KEY." };
  if (premiumCfg) {
    try {
      const leads = await premium.listLeads({ limit: 1 });
      premiumState = { state: "connected", tone: "good", detail: `${premiumCfg.apiBase} · ${leads.length ? "leads readable" : "no leads yet"}` };
    } catch (error) {
      premiumState = { state: "error", tone: "risk", detail: error instanceof Error ? error.message : "unknown" };
    }
  }
  const feed = feedStatus();
  const twilio = twilioConfig();
  const demoTo = twilio?.demoTo ? toE164(twilio.demoTo) : null;
  const llm = llmConfig();
  const poll = inboundPollStatus();

  const rows: Row[] = [
    { name: "Premium internal API", ...premiumState },
    {
      name: "New-lead feed",
      state: feed.status === "subscribed" ? "live (Realtime)" : feed.status,
      tone: feed.status === "subscribed" ? "good" : feed.status === "polling" ? "caution" : "risk",
      detail: feed.detail,
      extra: [
        `Realtime: ${premiumRealtimeConfig() ? "premium \"leads\" broadcast, anon key" : "not configured (PREMIUM_SUPABASE_URL / PREMIUM_SUPABASE_ANON_KEY)"}`,
        `Last signal: ${feed.lastSignalAt ? when(feed.lastSignalAt) : "none yet"} · last sync: ${feed.lastSyncAt ? when(feed.lastSyncAt) : "none yet"}`,
      ],
    },
    {
      name: "WhatsApp (Twilio)",
      state: whatsappPaused() ? "paused" : twilio ? twilio.mode : "not set up",
      tone: whatsappPaused() ? "neutral" : twilio ? "good" : "caution",
      detail: whatsappPaused()
        ? "Paused (WHATSAPP_PAUSED=true): credentials kept, nothing sent or polled. Instant replies and rep messages go in-app. Remove the line from .env.local and restart to resume."
        : twilio
        ? `From ${twilio.from.replace("whatsapp:", "")}${twilio.mode === "sandbox" ? ` · sandbox${demoTo ? ` → every send goes to ${maskE164(demoTo)}` : " → to each lead's own number"}` : " · live → to each lead's own number"}`
        : "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM in .env.local.",
      extra: twilio
        ? [
            `24-hour-window template: ${twilio.contentSid ? `configured (${twilio.contentSid.slice(0, 6)}…)` : "none — outside the window, WhatsApp sends are refused"}`,
            twilio.webhookBase
              ? `Inbound webhook (where the sender allows one): ${twilio.webhookBase}/api/twilio/inbound (POST) · status callbacks: ${twilio.webhookBase}/api/twilio/status`
              : "Webhooks off: set TWILIO_WEBHOOK_BASE_URL to the public URL of this app (e.g. your ngrok https URL) for delivery-status updates.",
            `Inbound replies also read from Twilio's message log every ${poll.everySeconds}s${poll.lastPollAt ? ` · last read ${when(poll.lastPollAt)}` : ""}${poll.handled ? ` · ${poll.handled} handled` : ""}${poll.lastError ? ` · error: ${poll.lastError}` : ""}`,
          ]
        : undefined,
    },
    { name: "SMS", state: "not sent", tone: "neutral", detail: "Production TODO: TRAI DLT registration (entity, sender ID, templates) before any SMS." },
    { name: "AI drafting", state: llm ? "LLM" : "template", tone: llm ? "good" : "neutral", detail: llm ? `${llm.model} — every draft must pass the grounding guard` : "No GROQ_API_KEY — replies are composed deterministically from property facts." },
    { name: "Rep sign-in", state: authConfigured() ? "Clerk" : "off", tone: authConfigured() ? "good" : "caution", detail: authConfigured() ? "Roster reps only." : "Localhost-only demo (SALES_ALLOW_UNAUTHENTICATED_DEMO); tunnels reach only /api/twilio/*." },
    { name: "Sales store", state: store().kind === "supabase" ? "own Supabase" : "local file", tone: store().kind === "supabase" ? "good" : "caution", detail: salesSupabaseConfig() ? "SALES_SUPABASE_URL" : ".data/sales-store.json — sales state only (reps, assignments, consent, sequences…)" },
  ];
  const [events, counts, settings] = await Promise.all([store().listAudit(undefined, 25), navCounts(), visitSettings()]);

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts}>
      <PageHeader title="Settings" description="Visit hours for the booking page, and the technical connections behind the desk." />
      <Card title="Visit hours" eyebrow="What the buyer's booking page offers" className="mb-5">
        <VisitSettingsForm initial={settings} />
      </Card>
      <Card title="Connections" eyebrow="For whoever set the desk up — the real state of each integration; no key is ever shown." bodyClassName="pt-2">
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.name} className="grid gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-[14rem_10rem_1fr]">
              <span className="font-medium text-ink">{r.name}</span>
              <span><Badge tone={r.tone}>{r.state}</Badge></span>
              <div className="min-w-0 text-[13px] text-body">
                <p className="break-words">{r.detail}</p>
                {r.extra?.map((e) => <p key={e} className="mt-1 break-words text-[12px] text-muted">{e}</p>)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-5" title="System log" eyebrow="Latest 25 events">
        <ol className="space-y-2.5 border-l border-line pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-sage" />
              <p className="text-[13px] text-ink"><span className="font-medium">{e.kind}</span> <span className="text-muted">· {when(e.at)} · {e.leadId ?? "—"} · {e.actor}</span></p>
              <p className="text-[12px] text-muted">{e.detail}</p>
            </li>
          ))}
          {events.length === 0 && <li className="text-[13px] text-muted">Nothing yet.</li>}
        </ol>
      </Card>
    </AppShell>
  );
}

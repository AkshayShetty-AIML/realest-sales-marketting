import Link from "next/link";
import { LeadUnits } from "@/components/lead/units";
import type { ProposalContent } from "@/lib/proposals/proposals";
import { notFound } from "next/navigation";
import { requireRep } from "@/lib/auth";
import { premium, PremiumError } from "@/lib/premium/client";
import type { Property, Unit } from "@/lib/premium/contract";
import { store } from "@/lib/store";
import type { WaMessage } from "@/lib/store/types";
import { navCounts } from "@/lib/inbox-data";
import { deriveContext } from "@/lib/automation/context";
import { buildFacts, inr } from "@/lib/grounding/facts";
import { whatsappPlan, WINDOW_MS } from "@/lib/whatsapp/twilio";
import { AppShell } from "@/app/_shell/AppShell";
import { AiChip, ChannelChip, MaskedBadge, ScoreChip, StageChip, StatusChip } from "@/components/Chips";
import { scoringModel } from "@/lib/scoring/model";
import { BrochureItem, GenerateBrochure } from "@/components/lead/brochure";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Card, KeyValues } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LeadNurture } from "@/components/harness/LeadNurture";
import {
  AutoReplyButton,
  BookVisit,
  Composer,
  MessagingPrefs,
  ModeBanner,
  OwnerControl,
  RevealContact,
  StageControl,
  VisitStatus,
} from "@/components/lead/controls";
import { Lifecycle } from "@/components/lead/Lifecycle";
import { AttributionTags } from "@/components/marketing/AttributionTags";
import { marketing } from "@/lib/premium/marketing-client";
import { ScrollToEnd } from "@/components/lead/ScrollToEnd";
import { STATUS_LABEL } from "@/lib/premium/contract";
import { ago, when } from "@/lib/time";
import { RepCheckIn, SendBookingLink, StartSequence, StopRun } from "@/components/lead/automation";
import { formatDistance } from "@/lib/scheduling/geo";
import { checkInWindowOpen } from "@/lib/scheduling/time";
import { PENDING_TWILIO_LABEL } from "@/lib/automation/delivery";
import type { JobStatus } from "@/lib/store/types";

export const dynamic = "force-dynamic";


interface ThreadItem {
  id: string;
  at: string;
  inbound: boolean;
  channel: string;
  body: string;
  who: string;
  ai: boolean;
  wa: WaMessage | null;
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ existing?: string }> }) {
  const existingLead = (await searchParams).existing === "1";
  const rep = await requireRep();
  const leadId = decodeURIComponent((await params).id);

  let lead;
  try {
    lead = await premium.getLead(leadId);
  } catch (error) {
    if (error instanceof PremiumError && error.status === 404) notFound();
    return (
      <AppShell rep={rep.name} demo={rep.demo}>
        <ErrorPanel message={error instanceof Error ? error.message : "unknown error"} />
      </AppShell>
    );
  }

  const [property, units, autoReply, conversation, optIn, reps, assignments, events, waMessages, plan, counts, runs, jobs, sequences, checkIns, feedback, brochures, visitRecords] = await Promise.all([
    premium.getProperty(lead.propertyId).catch(() => null as Property | null),
    premium.listInventory({ projectId: lead.propertyId }).catch(() => [] as Unit[]),
    store().getAutoReply(leadId),
    store().getConversation(leadId),
    store().getOptIn(leadId),
    store().listReps(),
    store().listAssignments(leadId),
    store().listAudit(leadId, 30),
    store().listWaMessages(leadId),
    whatsappPlan(leadId),
    navCounts(),
    store().listRuns({ leadId }),
    store().listJobs({ leadId }),
    store().listSequences(),
    store().listCheckIns({ leadId }),
    store().listFeedback({ leadId }),
    store().listBrochures({ leadId }),
    store().listVisits({ leadId }),
  ]);
  const proposals = await store().listProposals({ leadId });
  const seqName = (id: string | null) => sequences.find((s) => s.id === id)?.name ?? (id ? "sequence" : "one-off");
  const activeRuns = runs.filter((r) => r.status === "active");
  const upcomingJobs = jobs.filter((j) => j.status === "pending").slice(0, 8);
  const recentJobs = jobs.filter((j) => j.status !== "pending" && j.executedAt).sort((a, b) => (b.executedAt ?? "").localeCompare(a.executedAt ?? "")).slice(0, 8);
  const JOB_TONE: Record<JobStatus, BadgeTone> = { pending: "neutral", running: "neutral", sent: "good", pending_twilio: "caution", skipped: "neutral", cancelled: "neutral", failed: "risk" };
  const jobLabel = (st: JobStatus) => (st === "pending_twilio" ? PENDING_TWILIO_LABEL : st);
  const context = deriveContext(lead, property);
  const score = scoringModel().score({ lead, property, visits: visitRecords, checkIns, feedback, optIn });
  const facts = property ? buildFacts(property) : [];
  const mode = conversation?.mode ?? "ai";
  const repName = (id: string | null) => (id ? reps.find((r) => r.id === id)?.name ?? id : null);
  /** Who sent an outbound message, in words: a rep's name, or which automation. */
  const AUTO: Record<string, string> = {
    "ai-auto-reply": "AI auto-reply",
    "visit-confirmation": "Visit confirmation · auto",
    "visit-cancellation": "Visit cancellation · auto",
    "feedback-request": "Feedback request · auto",
  };
  const senderLabel = (by: string) => AUTO[by] ?? (by.startsWith("brochure:") ? `Brochure · ${repName(by.slice(9)) ?? by.slice(9)}` : by.startsWith("sequence:") ? `Sequence · ${by.slice(9)}` : repName(by) ?? by);
  const waByPremium = new Map(waMessages.filter((m) => m.premiumMessageId).map((m) => [m.premiumMessageId as string, m]));

  const timeline: ThreadItem[] = [
    ...lead.messages.map((m) => ({
      id: m.id,
      at: m.createdAt,
      inbound: m.direction === "inbound",
      channel: m.channel,
      body: m.body,
      who: m.direction === "inbound" ? "Buyer" : senderLabel(m.sentBy),
      ai: m.sentBy === "ai-auto-reply" || m.sentBy.startsWith("sequence:") || m.sentBy in AUTO,
      wa: waByPremium.get(m.id) ?? null,
    })),
    // Queued (pending Twilio) and failed automated messages never reached the premium thread — show them, labelled.
    ...jobs
      .filter((j) => j.status === "pending_twilio" || (j.status === "failed" && j.body))
      .map((j) => ({ id: `job-${j.id}`, at: j.executedAt ?? j.runAt, inbound: false, channel: j.channel, body: j.body ?? j.template, who: j.status === "pending_twilio" ? `Queued · ${PENDING_TWILIO_LABEL}` : `Failed · ${j.note ?? ""}`, ai: true, wa: null })),
    // Sends Twilio refused never reached the premium thread — show them here, marked failed.
    ...waMessages
      .filter((m) => !m.premiumMessageId)
      .map((m) => ({ id: m.id, at: m.at, inbound: false, channel: "whatsapp", body: m.body, who: m.sentBy === "ai-auto-reply" ? "AI auto-reply" : repName(m.sentBy) ?? m.sentBy, ai: m.sentBy === "ai-auto-reply", wa: m })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const composerPlan = {
    configured: plan.configured,
    optedIn: plan.optedIn,
    to: plan.to,
    problem: plan.problem,
    windowOpen: plan.windowOpen,
    windowClosesAt: plan.lastInboundAt ? new Date(Date.parse(plan.lastInboundAt) + WINDOW_MS).toISOString() : null,
    templateAvailable: plan.templateAvailable,
    sandbox: plan.sandbox,
  };

  // ── Journey: one sequence — reached out → booked a visit → visit done ──
  const firstOut = lead.messages.find((m) => m.direction === "outbound");
  const liveVisits = lead.visits.filter((v) => v.status !== "cancelled");
  const visit = [...liveVisits].sort((x, y) => y.slot.localeCompare(x.slot))[0] ?? null;
  const done = lead.visits.find((v) => v.status === "completed") ?? null;
  const proof = done ? checkIns.filter((c) => c.visitId === done.id && c.onSite).at(-1) : visit ? checkIns.filter((c) => c.visitId === visit.id).at(-1) : undefined;
  const fb = done ? feedback.find((f) => f.visitId === done.id) : undefined;
  const upcomingVisit = visit && (visit.status === "scheduled" || visit.status === "confirmed") ? visit : null;
  const whatsappLive = plan.configured && !plan.problem;
  const wants = context.requirements.filter((r) => ["Configuration", "Budget", "Timeline"].includes(r.label) && !r.value.startsWith("not stated")).map((r) => r.value.replace(/ \(stated\)$/, ""));
  const topReasons = score.reasons.slice().sort((x, y) => Math.abs(y.points) - Math.abs(x.points));

  // Marketing tags (campaign / source / archetype) from the spine — never blocks the page.
  const attribution = await marketing.getAttribution(lead.id).catch(() => null);

  return (
    <AppShell rep={rep.name} demo={rep.demo} counts={counts} fit>
      {existingLead && <p role="status" className="mb-3 rounded-control border border-line bg-brand-mist px-3 py-2 text-[13px] text-brand">This person is already a lead on this project, so nothing new was created — here is their lead.</p>}
      {/* ── Header ── */}
      <div className="mb-3 flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/inbox" className="text-[12px] font-medium text-muted hover:text-brand">← Back to leads</Link>
          <h1 className="mt-0.5 truncate font-display text-[30px] leading-tight text-ink">{lead.context.property?.name ?? lead.propertyId}</h1>
          <p className="text-[13px] text-body">
            {lead.contact.name ?? "Buyer"}{lead.context.property && ` · ${lead.context.property.locality}, ${lead.context.property.city}`} · {lead.kind} inquiry · {ago(lead.createdAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ScoreChip band={score.band} score={score.score} />
            <StatusChip status={lead.status} />
            <AiChip outcome={autoReply?.outcome ?? null} mode={mode} />
            {lead.assignedTo ? <Badge tone="neutral">Owner: {repName(lead.assignedTo)}</Badge> : <Badge tone="caution">Unassigned</Badge>}
            <AttributionTags a={attribution} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <LiveRefresh seconds={15} />
          {!autoReply && !lead.messages.some((m) => m.sentBy === "ai-auto-reply") && <AutoReplyButton leadId={lead.id} label="Send instant reply" />}
          {autoReply?.outcome === "failed" && <AutoReplyButton leadId={lead.id} label="Retry instant reply" />}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,430px)_minmax(0,1fr)] gap-4">
        {/* ── LEFT: context, strict priority (a)→(g); scrolls inside the pane ── */}
        <div className="min-h-0 space-y-3 overflow-y-auto pb-2 pr-1" aria-label="About this lead">
          {/* (a) identity */}
          <Card title="About this buyer" action={<MaskedBadge masked={context.person.masked} />} bodyClassName="px-5 py-2.5">
            <KeyValues dense rows={[
              { label: "Name", value: context.person.name },
              { label: "Phone", value: <span className="font-tabular">{context.person.phone}</span> },
              { label: "Email", value: context.person.email },
              { label: "Looking for", value: wants.length ? wants.join(" · ") : "not stated yet" },
              { label: "Source", value: `Premium app · ${ago(lead.createdAt)}` },
              { label: "Owner", value: <OwnerControl leadId={lead.id} assignedTo={lead.assignedTo} reps={reps.filter((r) => r.active)} /> },
            ]} />
            <div className="mt-1.5"><RevealContact leadId={lead.id} /></div>
          </Card>

          {/* (b) lead score */}
          <Card title="Lead score" action={<ScoreChip band={score.band} score={score.score} />} bodyClassName="px-5 py-2.5">
            <ol className="relative space-y-1 border-l border-line pl-4">
              {topReasons.slice(0, 4).map((r) => (
                <li key={r.label} className="relative text-[13px]">
                  <span aria-hidden className={`absolute -left-[20.5px] top-[7px] h-2 w-2 rounded-full ${r.points > 0 ? "bg-forest" : "bg-rust"}`} />
                  <span className={`font-tabular font-semibold ${r.points > 0 ? "text-forest" : "text-rust"}`}>{r.points > 0 ? "+" : "−"}{Math.abs(r.points)}</span>{" "}
                  <span className="text-body">{r.label}</span>
                </li>
              ))}
              {topReasons.length === 0 && <li className="text-[13px] text-muted">No signals yet beyond the inquiry.</li>}
            </ol>
            {topReasons.length > 4 && (
              <details className="mt-1.5">
                <summary className="cursor-pointer list-none text-[12px] font-medium text-brand hover:underline">All {topReasons.length} reasons</summary>
                <ul className="mt-1 space-y-0.5 text-[12px] text-body">
                  {topReasons.slice(4).map((r) => <li key={r.label}><span className="font-tabular">{r.points > 0 ? "+" : "−"}{Math.abs(r.points)}</span> {r.label}</li>)}
                </ul>
              </details>
            )}
          </Card>

          {/* (b2) marketing nurture — the harness's archetype sequence, first message waiting for approval */}
          <LeadNurture operatorId={rep.repId} leadId={lead.id} />

          {/* (c) pipeline stage — moves on its own */}
          <Card title="Pipeline stage" action={<StageChip stage={lead.stage} />} bodyClassName="px-5 py-2.5">
            <p className="text-[12px] text-muted">Moves on its own as the buyer books and visits · status {STATUS_LABEL[lead.status].toLowerCase()}</p>
            <div className="mt-1"><StageControl leadId={lead.id} stage={lead.stage} status={lead.status} /></div>
          </Card>

          {/* (d) lifecycle — one sequence */}
          <Card title="Journey" bodyClassName="px-5 py-2.5">
            <Lifecycle
              steps={[
                { label: "Reached out", done: Boolean(firstOut), detail: firstOut ? `${firstOut.sentBy === "ai-auto-reply" ? "Instant AI reply" : senderLabel(firstOut.sentBy)} · ${when(firstOut.createdAt)}` : "Not yet" },
                {
                  label: "Booked a visit",
                  done: Boolean(visit),
                  detail: visit ? `${when(visit.slot)} · ${visit.status === "no_show" ? "missed" : visit.status.replace("_", " ")}${liveVisits.length > 1 ? ` · ${liveVisits.length} visits so far` : ""}` : "Not yet",
                  tone: visit?.status === "no_show" ? "risk" : undefined,
                },
                {
                  label: "Visit done",
                  done: Boolean(done),
                  detail: done
                    ? `${when(done.slot)}${proof?.onSite ? ` · checked in ${formatDistance(proof.distanceM)} from site` : ""}${fb ? ` · feedback: ${fb.interest.replace("_", " ")}` : ""}`
                    : "Not yet",
                },
              ]}
            />
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              {upcomingVisit ? (
                <>
                  {checkInWindowOpen(upcomingVisit.slot) && <RepCheckIn leadId={lead.id} visitId={upcomingVisit.id} />}
                  <VisitStatus leadId={lead.id} visitId={upcomingVisit.id} status={upcomingVisit.status} />
                </>
              ) : (
                <SendBookingLink leadId={lead.id} />
              )}
              <details>
                <summary className="cursor-pointer list-none text-[12px] font-medium text-brand hover:underline">Book a time for the buyer</summary>
                <div className="mt-2"><BookVisit leadId={lead.id} /></div>
              </details>
            </div>
          </Card>

          {/* (e) brochure + FAQ AI */}
          <Card title="Brochure & AI answers" action={property ? <GenerateBrochure leadId={lead.id} /> : undefined} bodyClassName="px-5 py-3">
            {brochures.length ? (
              <ul className="space-y-3">
                {brochures.slice(0, 1).map((b) => (
                  <BrochureItem
                    key={b.id}
                    leadId={lead.id}
                    latest
                    b={{
                      id: b.id,
                      createdAt: b.createdAt,
                      createdLabel: when(b.createdAt),
                      engine: b.engine,
                      fallbackReason: b.fallbackReason,
                      deliveries: b.deliveries.map((d) => ({ channel: d.channel, status: d.status, atLabel: when(d.at) })),
                    }}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{property ? "A personalised PDF: how the home fits what they asked for, the honest grade and key facts." : "The property couldn't be loaded, so no brochure can be made."}</p>
            )}
            {property && (
              <details className="mt-2.5 border-t border-line pt-2.5">
                <summary className="cursor-pointer list-none text-[12px] font-medium text-brand hover:underline">What the AI can answer ({facts.length} facts)</summary>
                <div className="mt-2"><KeyValues rows={facts.map((f) => ({ label: f.label, value: f.value }))} /></div>
                <p className="mt-2 text-[12px] text-muted">AI replies use these facts only; anything else waits for you. Use “Answer with AI” under the conversation.</p>
              </details>
            )}
          </Card>

          {/* (e2) units: the allocation lock + proposals (OPS-01 / OPS-02) */}
          <Card title="Units & proposals" bodyClassName="px-5 py-2">
            <LeadUnits
              leadId={lead.id}
              units={units.map((u) => ({
                unitId: u.unitId,
                label: u.label ?? u.unitNo ?? u.unitId,
                detail: [u.config, u.floor !== null && u.floor !== undefined ? `Floor ${u.floor}` : null, u.facing ? `${u.facing} facing` : null, u.price ? inr(u.price) : null].filter(Boolean).join(" · ") || "Details as listed",
                status: u.availability ?? u.status,
                indicative: Boolean(u.indicative),
                holdNote: (u.availability ?? u.status) === "held" ? `Held${u.hold?.by ? ` by ${repName(u.hold.by)}` : ""}${u.hold?.leadId === lead.id ? " for this buyer" : u.hold?.leadId ? " for another buyer" : ""}${u.blockedUntil ? ` until ${when(u.blockedUntil)}` : ""}` : u.bookingRef ? `Sold · booking ${u.bookingRef}` : null,
                heldForThisLead: (u.availability ?? u.status) === "held" && u.hold?.leadId === lead.id,
              }))}
              proposals={proposals.map((p) => {
                const c = p.content as ProposalContent;
                return {
                  id: p.id,
                  version: p.version,
                  unitLabel: c.unit.label,
                  total: c.sheet.onRequest ? "on request" : inr(c.sheet.total),
                  toConfirm: c.sheet.onRequest ? [] : c.sheet.toConfirm,
                  createdLabel: when(p.createdAt),
                  sendStatus: p.send.status,
                  note: p.send.note,
                };
              })}
            />
          </Card>

          {/* (f) messaging preferences — replaces the WhatsApp card */}
          <Card title="Messaging preferences" bodyClassName="px-5 py-2.5">
            <MessagingPrefs leadId={lead.id} whatsapp={optIn?.status ?? null} whatsappLive={whatsappLive} />
          </Card>

          {/* (g) automation & developer detail — last, collapsed */}
          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[14px] font-semibold text-ink">
              Automation &amp; history
              <span className="text-[12px] font-normal text-muted">{activeRuns.length} follow-up{activeRuns.length === 1 ? "" : "s"} running · show</span>
            </summary>
            <div className="space-y-4 border-t border-line px-5 py-4">
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Follow-ups</h3>
                {activeRuns.length > 0 && (
                  <ul className="mb-3 space-y-1.5">
                    {activeRuns.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="text-ink">{seqName(r.sequenceId)} <span className="text-muted">· since {when(r.startedAt)}</span></span>
                        <StopRun leadId={lead.id} runId={r.id} />
                      </li>
                    ))}
                  </ul>
                )}
                <StartSequence leadId={lead.id} options={sequences.filter((x) => x.active && x.trigger !== "visit_booked").map((x) => ({ id: x.id, name: x.name }))} />
                {upcomingJobs.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[12px]">
                    {upcomingJobs.map((j) => (
                      <li key={j.id} className="flex items-start justify-between gap-2">
                        <span className="text-body">{when(j.runAt)} · {seqName(j.sequenceId)}</span>
                        {j.channel === "in_app" ? <Badge tone="brand" dot={false}>in-app</Badge> : <Badge tone="caution" dot={false}>{j.channel} · pending setup</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
                {recentJobs.length > 0 && (
                  <ul className="mt-3 space-y-1 text-[12px]">
                    {recentJobs.map((j) => (
                      <li key={j.id} className="flex items-start justify-between gap-2">
                        <span className="text-body">{when(j.executedAt as string)} · {j.channel.replace("_", "-")} · {seqName(j.sequenceId)}</span>
                        <Badge tone={JOB_TONE[j.status]}>{jobLabel(j.status)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">WhatsApp delivery</h3>
                <KeyValues rows={[
                  { label: "Sends to", value: plan.to ?? (plan.problem ?? "—") },
                  { label: "24-hour window", value: plan.windowOpen ? `Open until ${when(composerPlan.windowClosesAt as string)}` : `Closed${plan.templateAvailable ? " — template only" : ""}` },
                  { label: "Consent source", value: optIn ? `${optIn.source} · ${when(optIn.recordedAt)}` : "not recorded" },
                ]} />
              </section>
              <section>
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-sage-ink">Activity</h3>
                <ol className="space-y-2 border-l border-line pl-4">
                  {events.map((e) => (
                    <li key={e.id} className="relative">
                      <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-sage" />
                      <p className="text-[12px] text-ink"><span className="font-medium">{e.kind}</span> <span className="text-muted">· {when(e.at)} · {repName(e.actor) ?? e.actor}</span></p>
                      <p className="text-[12px] text-muted">{e.detail}</p>
                    </li>
                  ))}
                  {events.length === 0 && <li className="text-[13px] text-muted">Nothing yet.</li>}
                </ol>
                {assignments.length > 0 && <p className="mt-2 text-[12px] text-muted">Routing: {assignments.slice(-1).map((x) => `${repName(x.repId)} · ${x.reason}`)}</p>}
              </section>
            </div>
          </details>
        </div>

        {/* ── RIGHT: the conversation ── */}
        <section className="card flex min-h-0 flex-col overflow-hidden" aria-label="Conversation">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 pt-3">
            <h2 className="border-b-2 border-forest pb-2.5 text-[14px] font-semibold text-ink">Conversation <span className="font-normal text-muted">· {timeline.length}</span></h2>
            <span className="pb-2.5 text-[12px] text-muted">Premium app thread</span>
          </header>
          <div className="shrink-0 px-5 pt-3">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-mint-light px-3 py-1 text-[12px] text-sage-ink">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-forest" /> Instant replies by AI · grounded on this property&apos;s data
            </p>
          </div>

          <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-label="Messages">
            {timeline.map((m) => {
              const failed = m.wa && (m.wa.status === "failed" || m.wa.status === "undelivered");
              const queued = m.who.startsWith("Queued");
              return (
                <li key={m.id} className={`flex flex-col ${m.inbound ? "items-start" : "items-end"}`}>
                  {!m.inbound && m.who !== repName(rep.repId) && <span className="mb-1 px-1 text-[11px] font-medium text-sage-ink">{queued ? "Waiting for WhatsApp/email setup" : m.who}</span>}
                  <div
                    className={`max-w-[75%] rounded-[16px] px-4 py-2.5 text-[14px] leading-relaxed text-ink ${
                      failed
                        ? "rounded-br-[4px] bg-trust-risk-bg"
                        : m.inbound
                          ? "rounded-bl-[4px] border border-line bg-bubble-in shadow-control"
                          : queued
                            ? "rounded-br-[4px] border border-dashed border-line-strong bg-surface-alt text-body"
                            : "rounded-br-[4px] bg-bubble-out"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {failed && m.wa?.errorMessage && <p className="mt-1 text-[12px] text-rust">{m.wa.errorMessage}</p>}
                  </div>
                  <span className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted">
                    {when(m.at)}
                    {m.channel !== "in_app" && <ChannelChip channel={m.channel} />}
                    {!m.inbound && !queued && !failed && <span aria-label="Delivered" className="text-forest">✓✓</span>}
                  </span>
                </li>
              );
            })}
            {timeline.length === 0 && <li className="py-10 text-center text-[14px] text-muted">No messages yet.</li>}
            <ScrollToEnd count={timeline.length} />
          </ol>

          <div className="shrink-0 space-y-2 border-t border-line bg-surface px-5 py-3">
            <ModeBanner leadId={lead.id} mode={mode} />
            <Composer
              leadId={lead.id}
              plan={composerPlan}
              suggestion={conversation?.suggestedDraft ? { body: conversation.suggestedDraft.body, factKeys: conversation.suggestedDraft.factKeys, humanTopics: conversation.suggestedDraft.humanTopics } : null}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

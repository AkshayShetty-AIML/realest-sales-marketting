import type { ReactNode } from "react";
import { resolveLink } from "@/lib/links";
import { premium } from "@/lib/premium/client";
import { store } from "@/lib/store";
import { availableSlots } from "@/lib/scheduling/slots";
import { checkInWindowOpen, formatIst, istParts } from "@/lib/scheduling/time";
import { findVisit, visitSettings } from "@/lib/automation/visits";
import { greetingName } from "@/lib/grounding/compose";
import { FeedbackForm, SlotPicker, VisitActions, type SlotDayView } from "@/components/buyer/BuyerUI";
import { LogoMark } from "@/components/icons";

/**
 * /b/<token> — the BUYER's page (booking · visit management · feedback).
 * Public: the random token is the credential. Shows the property and the
 * buyer's own visit only — never contact details, never other buyers.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Your site visit" };

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Frame({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-2 text-brand">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-white"><LogoMark size={17} /></span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-sage-ink">{eyebrow}</span>
        </div>
        <section className="card p-6 sm:p-8">
          <h1 className="font-display text-[28px] leading-tight text-ink">{title}</h1>
          <div className="mt-5">{children}</div>
        </section>
        <p className="mt-6 text-center text-[12px] text-muted">This link is just for you. Questions? Reply in your inbox in the app.</p>
      </div>
    </main>
  );
}

async function slotDays(propertyId: string, excludeVisitId?: string): Promise<SlotDayView[]> {
  const settings = await visitSettings();
  const days = availableSlots(new Date(), settings, propertyId, await store().listVisits({ propertyId }), excludeVisitId);
  return days.map((d) => {
    const p = istParts(new Date(d.slots[0].start));
    return {
      dayKey: d.dayKey,
      weekday: WEEKDAY[p.weekday],
      dayNum: String(p.day),
      month: MONTH[p.month],
      slots: d.slots.map((s) => ({ start: s.start, label: formatIst(s.start, "time"), remaining: s.remaining })),
    };
  });
}

export default async function BuyerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveLink(token);
  if (!resolved.ok) {
    return (
      <Frame eyebrow="Site visit" title={resolved.reason === "expired" ? "This link has expired" : "This link isn't valid"}>
        <p className="text-[15px] text-body">Ask for a new one by replying in your inbox in the app.</p>
      </Frame>
    );
  }
  const { link } = resolved;
  const lead = await premium.getLead(link.leadId).catch(() => null);
  if (!lead) {
    return (
      <Frame eyebrow="Site visit" title="We couldn't load this">
        <p className="text-[15px] text-body">Please try again in a moment.</p>
      </Frame>
    );
  }
  const property = lead.context.property;
  const name = greetingName(lead.contact.name);
  const propertyLine = property ? `${property.name} · ${property.locality}, ${property.city}` : lead.propertyId;

  // ── Booking ──
  if (link.purpose === "book") {
    const active = (await store().listVisits({ leadId: lead.id })).find((v) => v.status === "scheduled" || v.status === "confirmed");
    return (
      <Frame eyebrow="Book a site visit" title={`${name ? `Hi ${name} — ` : ""}visit ${property?.name ?? "the property"}`}>
        <p className="mb-5 text-[14px] text-body">{propertyLine}</p>
        {active ? (
          <div className="rounded-[12px] bg-brand-mist p-4 text-[14px] text-brand">
            You already have a visit on <strong>{formatIst(active.slot)}</strong>. Use the link in your inbox to change it.
          </div>
        ) : (
          <SlotPicker token={token} days={await slotDays(lead.propertyId)} mode="book" />
        )}
      </Frame>
    );
  }

  // ── Brochure ──
  if (link.purpose === "brochure") {
    const brochure = link.brochureId ? await store().getBrochure(link.brochureId) : null;
    if (!brochure || brochure.leadId !== lead.id) {
      return (
        <Frame eyebrow="Your brochure" title="We couldn't find this brochure">
          <p className="text-[15px] text-body">Reply in your inbox and we&apos;ll send a fresh one.</p>
        </Frame>
      );
    }
    const c = brochure.content;
    return (
      <Frame eyebrow="Your brochure" title={c.headline}>
        <p className="mb-4 text-[14px] text-body">{propertyLine}</p>
        <p className="text-[15px] leading-relaxed text-body">{c.intro}</p>
        <ul className="mt-5 divide-y divide-line rounded-[12px] border border-line bg-white">
          {c.fit.map((f) => (
            <li key={f.label} className="flex items-start justify-between gap-3 px-4 py-3 text-[14px]">
              <span className="text-muted">{f.label}</span>
              <span className="text-right text-ink">{f.home}{f.verdict === "match" ? " ✓" : ""}</span>
            </li>
          ))}
        </ul>
        <a href={`/b/${token}/brochure.pdf`} className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-[8px] bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-hover">
          Open the full brochure (PDF)
        </a>
        <p className="mt-3 text-center text-[12px] text-muted">Honest grade {c.property.grade} · every figure is from the verified listing</p>
      </Frame>
    );
  }

  const visit = link.visitId ? await findVisit(link.visitId) : null;
  if (!visit) {
    return (
      <Frame eyebrow="Site visit" title="We couldn't find this visit">
        <p className="text-[15px] text-body">Reply in your inbox and we&apos;ll sort it out.</p>
      </Frame>
    );
  }

  // ── Feedback ──
  if (link.purpose === "feedback") {
    const done = (await store().listFeedback({ visitId: visit.visitId })).length > 0;
    return (
      <Frame eyebrow="How was your visit?" title={`Your visit to ${property?.name ?? "the property"}`}>
        <p className="mb-6 text-[14px] text-body">{formatIst(visit.slot)} · two quick questions</p>
        {done ? <p className="rounded-[12px] bg-trust-good-bg p-4 text-[15px] text-trust-good">We have your feedback — thank you!</p> : <FeedbackForm token={token} />}
      </Frame>
    );
  }

  // ── Visit management ──
  const upcoming = visit.status === "scheduled" || visit.status === "confirmed";
  const checkedIn = (await store().listCheckIns({ visitId: visit.visitId })).some((c) => c.onSite);
  const canCheckIn = upcoming && !checkedIn && checkInWindowOpen(visit.slot);
  const STATUS: Record<string, string> = { scheduled: "Booked", confirmed: "Confirmed", completed: "Visited", cancelled: "Cancelled", no_show: "Missed" };

  return (
    <Frame eyebrow="Your site visit" title={property?.name ?? "Your visit"}>
      <div className="mb-6 rounded-[12px] border border-line bg-white p-4">
        <p className="text-[13px] text-muted">{propertyLine}</p>
        <p className="mt-1 font-display text-[22px] text-ink">{formatIst(visit.slot)}</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-wash px-2.5 py-1 text-[12px] font-medium text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {STATUS[visit.status] ?? visit.status}
          {checkedIn ? " · checked in" : ""}
        </p>
      </div>
      {upcoming ? (
        <>
          <VisitActions token={token} canCheckIn={canCheckIn} status={visit.status} />
          <details className="mt-6 border-t border-line pt-5">
            <summary className="cursor-pointer list-none text-[15px] font-semibold text-brand">Reschedule — pick a new time</summary>
            <div className="mt-4"><SlotPicker token={token} days={await slotDays(visit.propertyId, visit.visitId)} mode="reschedule" /></div>
          </details>
        </>
      ) : visit.status === "completed" ? (
        <p className="text-[15px] text-body">Thanks for visiting{name ? `, ${name}` : ""}! We&apos;ve sent a short feedback form to your inbox.</p>
      ) : (
        <>
          <p className="mb-4 text-[15px] text-body">This visit is {visit.status === "no_show" ? "marked as missed" : "cancelled"}. Pick a new time:</p>
          <SlotPicker token={token} days={await slotDays(visit.propertyId)} mode="book" />
        </>
      )}
    </Frame>
  );
}

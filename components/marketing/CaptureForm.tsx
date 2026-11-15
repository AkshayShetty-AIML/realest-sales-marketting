"use client";

import { useState, useTransition } from "react";
import { captureAction, type CaptureResult } from "@/app/b/lp/actions";
import { MAGNET_LABEL, type Magnet } from "@/lib/premium/marketing-contract";
import { QuizForm, quizComplete, type PartialAnswers } from "./QuizForm";
import { SelectedUnitTag, useSelectedUnit } from "./project/Units";

/**
 * Lead capture + lead magnets on a landing page. Consent is per channel and
 * unticked by default; the exact wording is recorded with the lead. The quiz
 * is optional. On submit: one lead on the shared leads table, then the magnet.
 */
export function CaptureForm({ pageId, magnets, accent, utm, consentText, preview = false }: { pageId: string; magnets: Magnet[]; accent: string; utm: Record<string, string | undefined>; consentText: string; preview?: boolean }) {
  const [magnet, setMagnet] = useState<Magnet>(magnets[0] ?? "register_interest");
  const [f, setF] = useState({ name: "", phone: "", email: "", website: "", income: "", emis: "" });
  const [consent, setConsent] = useState({ in_app: false, email: false, whatsapp: false, sms: false });
  const [quiz, setQuiz] = useState<PartialAnswers>({});
  const [showQuiz, setShowQuiz] = useState(false);
  const [done, setDone] = useState<Extract<CaptureResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // On a project page: the unit picked in the availability view (never an indicative placeholder).
  const { unit } = useSelectedUnit();

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await captureAction({
        pageId,
        unitId: unit && !unit.indicative ? unit.id : undefined,
        magnet,
        name: f.name,
        phone: f.phone,
        email: f.email,
        website: f.website,
        consent,
        utm,
        answers: quizComplete(quiz) ? quiz : undefined,
        eligibility: magnet === "eligibility" ? { monthlyIncome: Number(f.income) || 0, existingEmis: Number(f.emis) || 0 } : undefined,
      });
      if (r.ok) setDone(r);
      else setError(r.error);
    });

  if (done) {
    const r = done.result;
    return (
      <div className="rounded-[14px] border border-line bg-surface-alt p-5" role="status">
        <p className="text-[18px] font-semibold text-ink">Thank you — the team will be in touch.</p>
        {preview && <p className="mt-1 text-[12px] text-muted">Test enquiry saved — the sales team will see it under Leads{done.campaign ? `, tagged “${done.campaign}”` : ""}.</p>}
        {r.magnet === "brochure" && <a href={r.url} className="mt-3 inline-block rounded-[8px] px-4 py-2 text-[14px] font-medium text-white" style={{ background: accent }}>Open your brochure</a>}
        {r.magnet === "price_list" && (
          <div className="mt-3 text-[13px]">
            <table className="w-full text-left"><thead><tr className="text-muted"><th>Unit</th><th>Price</th><th>Verified</th></tr></thead>
              <tbody>{r.list.rows.map((u) => <tr key={u.unitId} className="border-t border-line"><td className="py-1">{u.unitId}</td><td>{u.price ?? "on request"}</td><td>{u.lastVerifiedAt}</td></tr>)}</tbody>
            </table>
            {r.list.rows.length === 0 && <p className="text-muted">No units are available right now — the team will contact you.</p>}
            <p className="mt-2 text-[12px] text-muted">{r.list.note}</p>
          </div>
        )}
        {r.magnet === "eligibility" && r.result && (
          <div className="mt-3 text-[14px] text-ink">
            <p>Indicative loan: <strong>₹{r.result.loan.toLocaleString("en-IN")}</strong> (EMI up to ₹{r.result.maxEmi.toLocaleString("en-IN")}/month)</p>
            <p className="mt-1 text-[12px] text-muted">Assumes {r.result.assumptions.annualRatePct}% a year over {r.result.assumptions.years} years and {Math.round(r.result.assumptions.foir * 100)}% of income towards EMIs. An estimate, not a loan offer.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-surface-alt p-5">
      <p className="text-[16px] font-semibold text-ink">Interested in this home?</p>
      <div className="mt-3"><SelectedUnitTag /></div>
      <div className="mt-3 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="What would you like?">
        {magnets.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={magnet === m} onClick={() => setMagnet(m)} className={`rounded-[8px] border px-2 py-2 text-[12px] font-medium ${magnet === m ? "text-white" : "border-line bg-white text-ink"}`} style={magnet === m ? { background: accent, borderColor: accent } : undefined}>
            {MAGNET_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <input className="control" placeholder="Your name" aria-label="Your name" value={f.name} onChange={set("name")} maxLength={120} />
        <input className="control" placeholder="Phone" aria-label="Phone" value={f.phone} onChange={set("phone")} maxLength={20} inputMode="tel" />
        <input className="control" placeholder="Email" aria-label="Email" value={f.email} onChange={set("email")} maxLength={254} inputMode="email" />
        <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden value={f.website} onChange={set("website")} />
        {magnet === "eligibility" && (
          <div className="grid grid-cols-2 gap-2">
            <input className="control" placeholder="Monthly income (₹)" aria-label="Monthly income" value={f.income} onChange={set("income")} inputMode="numeric" />
            <input className="control" placeholder="Existing EMIs (₹)" aria-label="Existing EMIs" value={f.emis} onChange={set("emis")} inputMode="numeric" />
          </div>
        )}
      </div>
      <fieldset className="mt-3">
        <legend className="text-[12px] font-medium text-ink">You may contact me by</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-[13px] text-body">
          {(["in_app", "email", "whatsapp", "sms"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={consent[c]} onChange={(e) => setConsent({ ...consent, [c]: e.target.checked })} /> {c === "in_app" ? "In-app" : c === "sms" ? "SMS" : c[0].toUpperCase() + c.slice(1)}</label>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted">{consentText}</p>
      </fieldset>
      <button type="button" className="mt-3 text-[12px] font-medium underline" style={{ color: accent }} onClick={() => setShowQuiz(!showQuiz)}>{showQuiz ? "Hide" : "Help us tailor what we send (optional, 5 quick questions)"}</button>
      {showQuiz && <div className="mt-2"><QuizForm value={quiz} onChange={setQuiz} compact /></div>}
      <button type="button" disabled={pending} onClick={submit} className="mt-4 h-11 w-full rounded-[8px] text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
        {pending ? "Sending…" : MAGNET_LABEL[magnet]}
      </button>
      {error && <p role="alert" className="mt-2 text-[12px] text-trust-risk">{error}</p>}
    </div>
  );
}

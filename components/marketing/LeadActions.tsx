"use client";

import { useState, useTransition } from "react";
import { enrolAction, setArchetypeAction } from "@/app/(marketing)/marketing/actions";
import { Button } from "@/components/ui/Button";
import { QuizForm, quizComplete, type PartialAnswers } from "./QuizForm";

/** Per buyer: answer 5 quick questions about them, then start the follow-ups made for their type of buyer. */
export function LeadActions({ campaignId, leadId, hasArchetype, enrolled }: { campaignId: string; leadId: string; hasArchetype: boolean; enrolled: boolean }) {
  const [open, setOpen] = useState(false);
  const [quiz, setQuiz] = useState<PartialAnswers>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{hasArchetype ? "Change buyer type" : "Find buyer type"}</Button>
        {enrolled ? (
          <span className="inline-flex h-9 items-center rounded-control px-3 text-[13px] font-medium text-trust-good">Follow-ups on ✓</span>
        ) : (
          <Button size="sm" disabled={pending || !hasArchetype} title={hasArchetype ? undefined : "Find the buyer type first"} onClick={() => start(async () => { const r = await enrolAction(campaignId, leadId); setMsg(r.ok ? { ok: true, text: "Follow-ups started." } : { ok: false, text: r.error }); })}>Start follow-ups</Button>
        )}
      </div>
      {open && (
        <div className="rounded-[10px] border border-line bg-white p-3">
          <QuizForm value={quiz} onChange={setQuiz} compact />
          <Button size="sm" className="mt-2" disabled={pending || !quizComplete(quiz)} onClick={() => start(async () => { const r = await setArchetypeAction(leadId, campaignId, quiz); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error }); if (r.ok) setOpen(false); })}>Save answers</Button>
        </div>
      )}
      {msg && <p role="status" className={`text-right text-[12px] ${msg.ok ? "text-trust-good" : "text-trust-risk"}`}>{msg.text}</p>}
    </div>
  );
}

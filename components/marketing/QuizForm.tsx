"use client";

import { QUIZ, type QuizAnswers } from "@/lib/premium/marketing-contract";

/** The five-question archetype quiz (the spine classifies the answers). */
export type PartialAnswers = Partial<Record<keyof QuizAnswers, string>>;

export function QuizForm({ value, onChange, compact = false }: { value: PartialAnswers; onChange: (v: PartialAnswers) => void; compact?: boolean }) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {(Object.keys(QUIZ) as (keyof typeof QUIZ)[]).map((key) => (
        <fieldset key={key}>
          <legend className="mb-1 text-[13px] font-medium text-ink">{QUIZ[key].label}</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(QUIZ[key].options).map(([opt, label]) => (
              <label key={opt} className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] ${value[key] === opt ? "border-brand bg-brand text-white" : "border-line bg-white text-body hover:border-line-strong"}`}>
                <input type="radio" className="sr-only" name={`quiz-${key}`} checked={value[key] === opt} onChange={() => onChange({ ...value, [key]: opt })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export const quizComplete = (v: PartialAnswers): v is QuizAnswers => (Object.keys(QUIZ) as (keyof typeof QUIZ)[]).every((k) => !!v[k]);

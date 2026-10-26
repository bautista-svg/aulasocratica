// The AI summary of the student's own work, when the activity shares it (Configuración →
// Devolución de la IA): the same reading the teacher sees, with the student's own words.
import { Sparkles, Sprout } from "lucide-react";
import { Spinner } from "@client/components/ui/spinner";
import type { StudentFeedback } from "@shared/contracts/student";
import type { SummaryPoint } from "@shared/domain/session-summary";
import { useT } from "./i18n";

export function FeedbackCard({ feedback }: { feedback: StudentFeedback }) {
  const t = useT();
  return (
    <section aria-labelledby="feedback-title" className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="feedback-title" className="font-display text-[22px] leading-tight font-semibold text-ink">
          {t.feedback.title}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-lilac-soft px-2.5 py-0.5 text-xs font-semibold text-lilac-ink">
          <Sparkles className="size-3" aria-hidden="true" /> {t.feedback.badge}
        </span>
      </div>
      <p className="mt-1.5 text-[15px] leading-6 text-text-2">{t.feedback.intro}</p>
      <div aria-live="polite">
        {feedback.status === "pending" ? (
          <p className="mt-5 flex items-center gap-3 rounded-lg bg-lilac-soft/60 px-4 py-3.5 text-sm leading-6 text-lilac-ink">
            <Spinner className="size-4 shrink-0" />
            {t.feedback.pending}
          </p>
        ) : (
          <div className="mt-5 space-y-5 border-t border-line pt-5">
            {feedback.overview ? <p className="text-[15px] leading-7 text-text">{feedback.overview}</p> : null}
            <Points title={t.feedback.byRubric} points={feedback.criteria} />
            <Points title={t.feedback.byObjectives} points={feedback.objectives} />
            {feedback.nextSteps.length ? (
              <div className="rounded-lg bg-leaf-soft px-4 py-3.5">
                <h3 className="text-sm font-semibold text-leaf">{t.feedback.nextSteps}</h3>
                <ul className="mt-2 space-y-2">
                  {feedback.nextSteps.map((n, i) => (
                    <li key={i} className="flex gap-2.5 text-[15px] leading-6 text-text">
                      <Sprout className="mt-1 size-4 shrink-0 text-leaf" aria-hidden="true" />
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Points({ title, points }: { title: string; points: SummaryPoint[] }) {
  if (!points.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <ul className="mt-2 space-y-3">
        {points.map((p, i) => (
          <li key={i} className="rounded-md bg-paper px-4 py-3">
            <p className="font-semibold text-text">{p.title}</p>
            <p className="mt-1 text-[15px] leading-6 text-text-2">{p.observation}</p>
            {p.evidence.map((e, j) => (
              <blockquote key={j} className="mt-2 border-l-2 border-lilac pl-3 text-sm text-text-2 italic">
                «{e}»
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

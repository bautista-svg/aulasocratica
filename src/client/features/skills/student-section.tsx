// Student page: the student's skills across the evaluated activities — the current level, how
// it evolved activity by activity, the evidence of each, and recommendations for the teacher.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Lightbulb } from "lucide-react";
import { cn } from "@client/lib/cn";
import { fmtDate, plural } from "@client/lib/format";
import { DIMENSIONS, DIMENSION_KEYS, STATUS_LABELS, toneOf } from "@shared/domain/skills";
import type { StudentSkillHistory, StudentSkills as Data } from "@shared/contracts/skills";
import { EvidenceCard, LevelPill, SkillGlyph, TONE_STYLE, ToneLegend } from "./ui";

export function StudentSkills({ data }: { data: Data }) {
  if (!data.assessedWorks) return null;
  const latest = (s: StudentSkillHistory) => s.history.at(-1)!;
  const good = data.skills.filter((s) => toneOf(latest(s).status) === "good");
  const grow = data.skills.filter((s) => toneOf(latest(s).status) === "grow");

  return (
    <section aria-labelledby="student-skills-title" className="mb-8 min-w-0 rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="student-skills-title" className="font-display text-lg font-semibold text-ink">
          Habilidades
        </h2>
        <p className="text-sm text-text-3">Según {plural(data.assessedWorks, "trabajo evaluado", "trabajos evaluados")}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Group title="Fortalezas" tone="good" skills={good} empty="Todavía ninguna habilidad lograda." />
        <Group title="Aspectos a desarrollar" tone="grow" skills={grow} empty="Nada para desarrollar por ahora." />
      </div>

      <ToneLegend className="mt-5" />
      <div className="mt-3 grid gap-5">
        {DIMENSION_KEYS.map((dim) => {
          const rows = data.skills.filter((s) => s.dimension === dim);
          if (!rows.length) return null;
          return (
            <div key={dim}>
              <p className="mb-2 text-xs font-semibold tracking-wide text-lilac-ink uppercase">{DIMENSIONS[dim]}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line">
                {rows.map((s) => (
                  <SkillEvolution key={s.key} s={s} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {data.recommendations.length ? (
        <div className="mt-5 rounded-[14px] bg-ink-soft/60 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Lightbulb className="size-4" aria-hidden="true" /> Recomendaciones para vos
          </h3>
          <ul className="mt-2 space-y-1.5">
            {data.recommendations.map((r) => (
              <li key={r} className="flex gap-2 text-[15px] leading-6 text-text">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-3">Del último trabajo evaluado.</p>
        </div>
      ) : null}
    </section>
  );
}

function Group({ title, tone, skills, empty }: { title: string; tone: "good" | "grow"; skills: StudentSkillHistory[]; empty: string }) {
  return (
    <div className={cn("rounded-[14px] p-4", TONE_STYLE[tone].soft)}>
      <h3 className={cn("text-sm font-semibold", TONE_STYLE[tone].text)}>{title}</h3>
      {skills.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <li key={s.key} className="rounded-full bg-surface px-2.5 py-1 text-sm font-semibold text-text shadow-1">
              {s.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-text-2">{empty}</p>
      )}
    </div>
  );
}

/** One row per skill: the evolution as dots (one per activity, oldest first) and the latest level. */
function SkillEvolution({ s }: { s: StudentSkillHistory }) {
  const [open, setOpen] = useState(false);
  const latest = s.history.at(-1)!;
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper">
        <SkillGlyph skill={s.key} status={latest.status} />
        <span className="min-w-32 flex-1 font-semibold text-text">{s.label}</span>
        <span className="flex items-center gap-1" aria-label={`Evolución: ${s.history.map((h) => STATUS_LABELS[h.status]).join(", ")}`}>
          {s.history.map((h, i) => (
            <span key={h.sessionId} className="flex items-center gap-1" aria-hidden="true">
              {i > 0 ? <span className="h-px w-2.5 bg-line-strong" /> : null}
              <span className={cn("size-3 rounded-full", TONE_STYLE[toneOf(h.status)].dot)} title={`${h.activityTitle}: ${STATUS_LABELS[h.status]}`} />
            </span>
          ))}
        </span>
        <LevelPill status={latest.status} />
        <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <ol className="grid gap-3 bg-paper/70 px-4 pt-1 pb-4">
          {[...s.history].reverse().map((h) => (
            <li key={h.sessionId}>
              <p className="mb-1.5 text-sm text-text-2">
                <Link to="/app/sesiones/$sessionId" params={{ sessionId: h.sessionId }} search={{ tab: "evaluacion" }} className="font-semibold text-ink underline-offset-4 hover:underline">
                  {h.activityTitle}
                </Link>{" "}
                · {fmtDate(h.at)}
              </p>
              <EvidenceCard a={h} />
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

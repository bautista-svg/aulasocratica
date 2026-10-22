// Student page: what the student stood out in and what to reinforce, across the activities
// whose works were analyzed (each activity links to that work's evaluation).
import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@client/lib/cn";
import { plural } from "@client/lib/format";
import { ASPECTS, ASPECT_KIND_LABELS, type AspectKind, type AspectMention } from "@shared/domain/aspects";
import type { StudentDetail } from "@shared/contracts/students";
import { AspectGlyph, KIND_STYLE, KindHeading } from "./ui";

export function StudentAspects({ data }: { data: StudentDetail["aspects"] }) {
  if (!data.analyzedWorks) return null;
  const of = (kind: AspectKind) =>
    data.aspects
      .map((a) => ({ aspect: a.aspect, mentions: kind === "strength" ? a.strengths : a.reinforce }))
      .filter((a) => a.mentions.length > 0)
      .sort((a, b) => b.mentions.length - a.mentions.length);

  return (
    <section aria-labelledby="student-aspects-title" className="mb-8 rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="student-aspects-title" className="font-display text-lg font-semibold text-ink">
          Fortalezas y aspectos a reforzar
        </h2>
        <p className="text-sm text-text-3">Según {plural(data.analyzedWorks, "trabajo analizado", "trabajos analizados")}</p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(["strength", "reinforce"] as AspectKind[]).map((kind) => {
          const list = of(kind);
          return (
            <div key={kind} className={cn("rounded-[14px] p-4", KIND_STYLE[kind].soft)}>
              <KindHeading kind={kind} label={ASPECT_KIND_LABELS[kind]} count={list.length} />
              {list.length ? (
                <ul className="mt-3 space-y-2.5">
                  {list.map((a) => (
                    <li key={a.aspect} className="flex gap-3 rounded-md bg-surface p-3 shadow-1">
                      <AspectGlyph aspect={a.aspect} kind={kind} />
                      <div className="min-w-0 flex-1">
                        <p className="pt-0.5 font-semibold text-text">
                          {ASPECTS[a.aspect].label}
                          {a.mentions.length > 1 ? <span className="ml-1.5 text-sm font-medium text-text-3">· en {a.mentions.length} actividades</span> : null}
                        </p>
                        <Activities mentions={a.mentions} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-text-2">{kind === "strength" ? "Todavía nada marcado." : "Nada para reforzar por ahora."}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Activities({ mentions }: { mentions: AspectMention[] }) {
  return (
    <p className="mt-0.5 text-sm text-text-2">
      {mentions.map((m, i) => (
        <Fragment key={m.sessionId}>
          {i > 0 ? ", " : null}
          <Link to="/app/sesiones/$sessionId" params={{ sessionId: m.sessionId }} search={{ tab: "evaluacion" }} className="underline-offset-4 hover:text-ink hover:underline">
            {m.who}
          </Link>
        </Fragment>
      ))}
    </p>
  );
}

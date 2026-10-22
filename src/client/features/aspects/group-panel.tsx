// Activity tab "Fortalezas": what the group stood out in and what to reinforce in class, counted
// from each work's aspects (AI suggestions the teacher kept plus the ones the teacher marked).
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Sparkles, Sprout } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Button } from "@client/components/ui/button";
import { EmptyState, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { plural } from "@client/lib/format";
import { ASPECTS, type AspectKind, type AspectTally } from "@shared/domain/aspects";
import { useActivityAspects, useGroupAnalysis } from "./api";
import { AspectGlyph, KIND_STYLE, KindHeading } from "./ui";

const countOf = (a: AspectTally, kind: AspectKind) => (kind === "strength" ? a.strengths : a.reinforce).length;

export function AspectsPanel({ activityId }: { activityId: string }) {
  const q = useActivityAspects(activityId);
  const group = useGroupAnalysis(activityId);
  if (q.isPending) return <SkeletonList rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const base = d.analyzedWorks;
  const top = (kind: AspectKind) =>
    d.aspects
      .filter((a) => countOf(a, kind) > 0)
      .sort((a, b) => countOf(b, kind) - countOf(a, kind))
      .slice(0, 3);

  async function analyzePending() {
    const r = await group.start(d.pending.map((p) => p.sessionId));
    if (r.done < r.total) return;
    if (r.failed) toast.error(`No pudimos analizar ${plural(r.failed, "trabajo", "trabajos")}. Probá de nuevo en un rato.`);
    else toast.success(`Listo: analizamos ${plural(r.total, "trabajo", "trabajos")}.`);
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-ink">Fortalezas y aspectos a reforzar</h2>
          <p className="mt-1 max-w-2xl text-[15px] leading-6 text-text-2">
            En qué se destacó el grupo y qué conviene reforzar en clase. Suma lo que la IA encontró en cada trabajo y lo que marcaste vos.
          </p>
        </div>
        {d.totalWorks ? (
          <p className="shrink-0 text-sm text-text-3">
            {base} de {plural(d.totalWorks, "trabajo analizado", "trabajos analizados")}
          </p>
        ) : null}
      </header>

      {d.pending.length || group.run.running ? (
        <div className="flex flex-col gap-4 rounded-[18px] bg-lilac-soft/70 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface text-lilac-ink shadow-1" aria-hidden="true">
            <Sparkles className="size-5" />
          </span>
          {group.run.running ? (
            <div className="min-w-0 flex-1" role="status">
              <p className="font-semibold text-text">
                Analizando {Math.min(group.run.done + 1, group.run.total)} de {group.run.total}…
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface"
                role="progressbar"
                aria-label="Trabajos analizados"
                aria-valuemin={0}
                aria-valuemax={group.run.total}
                aria-valuenow={group.run.done}
              >
                <div className="h-full rounded-full bg-lilac-ink transition-[width] duration-500" style={{ width: `${(group.run.done / group.run.total) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-sm text-text-2">El gráfico se completa a medida que terminan. Dejá esta pestaña abierta hasta el final.</p>
            </div>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-text">
                  {plural(d.pending.length, "trabajo terminado todavía sin analizar", "trabajos terminados todavía sin analizar")}
                </p>
                <p className="mt-0.5 text-sm text-text-2">La IA los lee uno por uno y propone sus fortalezas y aspectos a reforzar, con citas.</p>
              </div>
              <Button variant="primary" icon={<Sparkles className="size-4" />} className="shrink-0" onClick={() => void analyzePending()}>
                Analizar {plural(d.pending.length, "trabajo", "trabajos")}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {base === 0 ? (
        group.run.running ? null : (
          <EmptyState
            icon={<Sprout className="size-8" />}
            title={d.totalWorks ? "Todavía no hay trabajos analizados" : "Todavía nadie hizo esta actividad"}
            description={
              d.totalWorks
                ? "Analizá los trabajos terminados desde acá, o cada uno desde su pestaña Evaluación. También podés marcar vos los aspectos."
                : "Cuando los alumnos terminen, vas a ver acá en qué se destacó el grupo y qué conviene reforzar."
            }
          />
        )
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Highlight kind="strength" title="Lo más destacado del grupo" items={top("strength")} base={base} />
            <Highlight kind="reinforce" title="Para reforzar en clase" items={top("reinforce")} base={base} />
          </div>
          <AllAspects aspects={d.aspects} base={base} />
        </>
      )}
    </div>
  );
}

function Highlight({ kind, title, items, base }: { kind: AspectKind; title: string; items: AspectTally[]; base: number }) {
  return (
    <section className={cn("rounded-[18px] p-5", KIND_STYLE[kind].soft)}>
      <KindHeading kind={kind} label={title} />
      {items.length ? (
        <ol className="mt-4 space-y-3">
          {items.map((a) => {
            const n = countOf(a, kind);
            return (
              <li key={a.aspect} className="flex items-center gap-3">
                <AspectGlyph aspect={a.aspect} kind={kind} className="bg-surface shadow-1" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">{ASPECTS[a.aspect].label}</p>
                  <p className="text-sm text-text-2">
                    {n} de {plural(base, "alumno", "alumnos")}
                  </p>
                </div>
                <span className={cn("font-display text-[26px] leading-none font-semibold tabular", KIND_STYLE[kind].text)} aria-hidden="true">
                  {n}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-text-2">{kind === "strength" ? "Todavía no hay fortalezas marcadas." : "Nada para reforzar por ahora."}</p>
      )}
    </section>
  );
}

function AllAspects({ aspects, base }: { aspects: AspectTally[]; base: number }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="aspects-all-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="aspects-all-title" className="font-display text-lg font-semibold text-ink">
          Todos los aspectos
        </h3>
        <div className="flex items-center gap-4 text-xs font-semibold text-text-2">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", KIND_STYLE.strength.dot)} aria-hidden="true" /> Se destacaron
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", KIND_STYLE.reinforce.dot)} aria-hidden="true" /> A reforzar
          </span>
        </div>
      </div>
      {aspects.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-text-2">
          Los trabajos analizados todavía no tienen fortalezas ni aspectos a reforzar. Podés marcarlos vos desde cada trabajo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
          {aspects.map((a) => (
            <AspectBar key={a.aspect} tally={a} base={base} open={open === a.aspect} onToggle={() => setOpen((x) => (x === a.aspect ? null : a.aspect))} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AspectBar({ tally, base, open, onToggle }: { tally: AspectTally; base: number; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  const s = tally.strengths.length;
  const r = tally.reinforce.length;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(base, 1)) * 100)}%`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full flex-col gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-paper sm:flex-row sm:items-center sm:gap-5"
      >
        <span className="flex min-w-0 items-center gap-3 sm:w-60 sm:shrink-0">
          <AspectGlyph aspect={tally.aspect} kind="neutral" />
          <span className="font-semibold text-text">{ASPECTS[tally.aspect].label}</span>
          <span className="sr-only">
            : {s} se destacaron, {r} a reforzar
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3" aria-hidden="true">
          <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
            <span className={cn("h-full", KIND_STYLE.strength.bar)} style={{ width: pct(s) }} />
            <span className={cn("h-full", KIND_STYLE.reinforce.bar)} style={{ width: pct(r) }} />
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular">
            <span className={cn("min-w-7 rounded-full px-2 py-0.5 text-center", s ? KIND_STYLE.strength.tile : "bg-sunken text-text-3")}>{s}</span>
            <span className={cn("min-w-7 rounded-full px-2 py-0.5 text-center", r ? KIND_STYLE.reinforce.tile : "bg-sunken text-text-3")}>{r}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="grid gap-4 bg-paper/70 px-4 pt-2 pb-4 sm:grid-cols-2">
          {(["strength", "reinforce"] as AspectKind[]).map((kind) => {
            const list = kind === "strength" ? tally.strengths : tally.reinforce;
            return (
              <div key={kind}>
                <KindHeading kind={kind} label={kind === "strength" ? "Se destacaron" : "A reforzar"} count={list.length} as="h4" />
                {list.length ? (
                  <ul className="mt-2 space-y-2">
                    {list.map((m) => (
                      <li key={m.sessionId} className="rounded-md bg-surface px-3 py-2 shadow-1">
                        <Link
                          to="/app/sesiones/$sessionId"
                          params={{ sessionId: m.sessionId }}
                          search={{ tab: "evaluacion" }}
                          className="text-[15px] font-semibold text-ink underline-offset-4 hover:underline"
                        >
                          {m.who}
                        </Link>
                        {m.observation ? <p className="mt-0.5 line-clamp-2 text-sm text-text-2">{m.observation}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-text-3">Nadie.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

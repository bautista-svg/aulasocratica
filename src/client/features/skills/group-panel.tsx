// Activity tab "Fortalezas": the group's skills by dimension — how many students reached each
// level, the indicators, and each student's evidence one click away. Colors mean one thing each:
// green logrado/avanzado, orange inicial/en desarrollo, grey sin evidencia or not evaluated.
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, RefreshCw, SlidersHorizontal, Sparkles, Sprout, Target, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { Notice } from "@client/components/ui/misc";
import { errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { Button } from "@client/components/ui/button";
import { EmptyState, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { plural } from "@client/lib/format";
import {
  DIMENSIONS,
  DIMENSION_KEYS,
  LEVEL_RUBRIC,
  SKILL_LEVELS,
  STATUS_LABELS,
  evaluatedCount,
  goodCount,
  growCount,
  type SkillStatus,
} from "@shared/domain/skills";
import type { SkillGroupRow, SkillStudentEntry } from "@shared/contracts/skills";
import { useActivitySkills, useGroupAnalysis, useReevaluate } from "./api";
import { EvidenceCard, LevelPill, SkillGlyph, TONE_STYLE, ToneLegend } from "./ui";
import { SkillSettingsDialog } from "./settings-dialog";

export function SkillsPanel({ activityId }: { activityId: string }) {
  const q = useActivitySkills(activityId);
  const group = useGroupAnalysis(activityId);
  const reevaluate = useReevaluate(activityId);
  const qc = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const runStatus = q.data?.run?.status;
  const wasRunning = useRef(false);
  // When a run this page was watching finishes, say how it went and refresh every view.
  useEffect(() => {
    if (runStatus === "running") wasRunning.current = true;
    else if (wasRunning.current && runStatus) {
      wasRunning.current = false;
      if (runStatus === "done") toast.success("Listo: las habilidades se evaluaron de nuevo con lo que elegiste ahora.");
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      void qc.invalidateQueries({ queryKey: ["students"] });
    }
  }, [runStatus, qc]);
  if (q.isPending) return <SkeletonList rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const running = d.run?.status === "running";
  const top = (by: (r: SkillGroupRow) => number) =>
    d.skills
      .filter((s) => by(s) > 0)
      .sort((a, b) => by(b) - by(a))
      .slice(0, 3);

  async function analyzePending() {
    const r = await group.start(d.pending.map((p) => p.sessionId));
    if (r.done < r.total) return;
    if (r.failed) toast.error(`No pudimos evaluar ${plural(r.failed, "trabajo", "trabajos")}. Probá de nuevo en un rato.`);
    else toast.success(`Listo: evaluamos ${plural(r.total, "trabajo", "trabajos")}.`);
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-ink">Habilidades del grupo</h2>
          <p className="mt-1 max-w-2xl text-[15px] leading-6 text-text-2">
            Cada habilidad se evalúa de forma formativa, según la edad de tus alumnos y lo que pide la actividad: cuatro niveles con sus indicadores y una cita
            real de lo que escribió el alumno. Si la conversación no alcanza para evaluarla, queda «sin evidencia», que no es un desempeño bajo.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<SlidersHorizontal className="size-4" />} onClick={() => setChoosing(true)}>
            Elegir habilidades
          </Button>
          {d.assessedWorks > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-4" />}
              disabled={running || group.run.running}
              onClick={() => setConfirming(true)}
            >
              Reevaluar habilidades
            </Button>
          ) : null}
        </div>
      </header>

      {d.totalWorks ? (
        <dl className="grid grid-cols-3 gap-2 sm:max-w-xl">
          <Count label="Alumnos evaluados" value={d.assessedWorks} of={d.totalWorks} />
          <Count label="Intervenciones leídas" value={d.interventions} hint="Cuántos mensajes de los alumnos se leyeron (no mide calidad)." />
          <Count label="Habilidades" value={d.skills.length} />
        </dl>
      ) : null}

      {running && d.run ? (
        <div className="flex flex-col gap-4 rounded-[18px] bg-lilac-soft/70 p-4 sm:flex-row sm:items-center sm:p-5" role="status">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface text-lilac-ink shadow-1" aria-hidden="true">
            <RefreshCw className="size-5 animate-spin [animation-duration:2.5s]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text">
              Reevaluando las habilidades: {d.run.done} de {d.run.total} trabajos
            </p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface"
              role="progressbar"
              aria-label="Trabajos reevaluados"
              aria-valuemin={0}
              aria-valuemax={d.run.total}
              aria-valuenow={d.run.done}
            >
              <div className="h-full rounded-full bg-lilac-ink transition-[width] duration-500" style={{ width: `${(d.run.done / Math.max(d.run.total, 1)) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-text-2">
              Mientras tanto ves los resultados anteriores: se reemplazan todos juntos cuando termina. Podés cerrar esta página, sigue en el servidor.
            </p>
          </div>
        </div>
      ) : d.run?.status === "failed" ? (
        <Notice
          tone="amber"
          title="La reevaluación no se completó"
          action={
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={reevaluate.isPending} onClick={() => setConfirming(true)}>
              Intentar de nuevo
            </Button>
          }
        >
          {d.run.error || "Se mantienen los resultados anteriores."}
        </Notice>
      ) : d.outdatedWorks > 0 && !group.run.running ? (
        <div className="flex flex-col gap-4 rounded-[18px] bg-leaf-soft/70 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface text-leaf shadow-1" aria-hidden="true">
            <TrendingUp className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text">Hay criterios nuevos de evaluación formativa</p>
            <p className="mt-0.5 text-sm leading-6 text-text-2">
              {d.outdatedWorks === d.assessedWorks
                ? "Estos trabajos se evaluaron con los criterios anteriores, más exigentes."
                : `${plural(d.outdatedWorks, "trabajo se evaluó", "trabajos se evaluaron")} con los criterios anteriores, más exigentes.`}{" "}
              Reevaluá para que se reconozcan los avances parciales según la edad de tus alumnos.
            </p>
          </div>
          <Button variant="primary" icon={<RefreshCw className="size-4" />} className="shrink-0" onClick={() => setConfirming(true)}>
            Reevaluar habilidades
          </Button>
        </div>
      ) : null}

      {!running && (d.pending.length || group.run.running) ? (
        <div className="flex flex-col gap-4 rounded-[18px] bg-lilac-soft/70 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-surface text-lilac-ink shadow-1" aria-hidden="true">
            <Sparkles className="size-5" />
          </span>
          {group.run.running ? (
            <div className="min-w-0 flex-1" role="status">
              <p className="font-semibold text-text">
                Evaluando {Math.min(group.run.done + 1, group.run.total)} de {group.run.total}…
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface"
                role="progressbar"
                aria-label="Trabajos evaluados"
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
                  {plural(d.pending.length, "trabajo terminado todavía sin evaluar", "trabajos terminados todavía sin evaluar")}
                </p>
                <p className="mt-0.5 text-sm text-text-2">La IA los lee uno por uno y evalúa cada habilidad con su nivel y una cita del alumno.</p>
              </div>
              <Button variant="primary" icon={<Sparkles className="size-4" />} className="shrink-0" onClick={() => void analyzePending()}>
                Evaluar {plural(d.pending.length, "trabajo", "trabajos")}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {d.assessedWorks === 0 ? (
        group.run.running ? null : (
          <EmptyState
            icon={<Sprout className="size-8" />}
            title={d.totalWorks ? "Todavía no hay trabajos evaluados" : "Todavía nadie hizo esta actividad"}
            description={
              d.totalWorks
                ? "Evaluá los trabajos terminados desde acá, o cada uno desde su pestaña Evaluación."
                : "Cuando los alumnos terminen, vas a ver acá el nivel del grupo en cada habilidad."
            }
          />
        )
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Highlight tone="good" title="Fortalezas del grupo" icon={Sprout} items={top(byGood)} count={byGood} empty="Todavía ninguna habilidad lograda." />
            <Highlight tone="grow" title="Para desarrollar en clase" icon={Target} items={top(byGrow)} count={byGrow} empty="Nada para desarrollar por ahora." />
          </div>
          <section aria-labelledby="skills-all-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="skills-all-title" className="font-display text-lg font-semibold text-ink">
                Habilidades
              </h3>
              <ToneLegend />
            </div>
            <div className="mt-3 grid gap-5">
              {DIMENSION_KEYS.map((dim) => {
                const rows = d.skills.filter((s) => s.dimension === dim);
                if (!rows.length) return null;
                return (
                  <div key={dim}>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-lilac-ink uppercase">{DIMENSIONS[dim]}</p>
                    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
                      {rows.map((r) => (
                        <SkillBar key={r.key} row={r} base={d.assessedWorks} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
      <SkillSettingsDialog open={choosing} onOpenChange={setChoosing} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="primary"
        title="¿Reevaluar las habilidades de esta actividad?"
        description={
          <>
            <p>
              Se vuelven a analizar las conversaciones originales de los alumnos con los criterios de evaluación actuales y las habilidades e indicadores
              que elegiste ahora. Los resultados anteriores se reemplazan por completo, también los niveles que corregiste a mano.
            </p>
            <p className="mt-2">No se tocan las conversaciones, las respuestas ni los datos de los alumnos. Si algo falla, se mantienen los resultados anteriores.</p>
          </>
        }
        confirmLabel="Confirmar reevaluación"
        loading={reevaluate.isPending}
        onConfirm={() =>
          reevaluate.mutate(undefined, {
            onSuccess: () => setConfirming(false),
            onError: (e) => {
              setConfirming(false);
              toast.error(errorMessage(e));
            },
          })
        }
      />
    </div>
  );
}

function Count({ label, value, of, hint }: { label: string; value: number; of?: number; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-3.5 py-3" title={hint}>
      <dt className="text-xs font-semibold text-text-3">{label}</dt>
      <dd className="mt-0.5 font-display text-[22px] leading-tight font-semibold text-ink tabular">
        {value}
        {of !== undefined ? <span className="text-sm font-medium text-text-3"> de {of}</span> : null}
      </dd>
    </div>
  );
}

function Highlight({
  tone,
  title,
  icon: Icon,
  items,
  count,
  empty,
}: {
  tone: "good" | "grow";
  title: string;
  icon: typeof Sprout;
  items: SkillGroupRow[];
  count: (r: SkillGroupRow) => number;
  empty: string;
}) {
  return (
    <section className={cn("rounded-[18px] p-5", TONE_STYLE[tone].soft)}>
      <h3 className={cn("flex items-center gap-2 text-sm font-semibold", TONE_STYLE[tone].text)}>
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </h3>
      {items.length ? (
        <ol className="mt-4 space-y-3">
          {items.map((r) => {
            const n = count(r);
            return (
              <li key={r.key} className="flex items-center gap-3">
                <SkillGlyph skill={r.key} status={tone === "good" ? "logrado" : "en_desarrollo"} className="bg-surface shadow-1" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-text">{r.label}</p>
                  <p className="text-sm text-text-2">
                    {n} de {plural(evaluatedCount(r.counts), "alumno evaluado", "alumnos evaluados")}
                  </p>
                </div>
                <span className={cn("font-display text-[26px] leading-none font-semibold tabular", TONE_STYLE[tone].text)} aria-hidden="true">
                  {n}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-text-2">{empty}</p>
      )}
    </section>
  );
}

const byGood = (r: SkillGroupRow) => goodCount(r.counts);
const byGrow = (r: SkillGroupRow) => growCount(r.counts);

const ORDER: SkillStatus[] = ["avanzado", "logrado", "en_desarrollo", "inicial", "sin_evidencia"];

function SkillBar({ row, base }: { row: SkillGroupRow; base: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const good = goodCount(row.counts);
  const grow = growCount(row.counts);
  const none = row.counts.sin_evidencia + row.counts.no_evaluado;
  const pct = (n: number) => `${Math.min(100, (n / Math.max(base, 1)) * 100)}%`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-paper sm:flex-row sm:items-center sm:gap-5"
      >
        <span className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
          <SkillGlyph skill={row.key} />
          <span className="font-semibold text-text">{row.label}</span>
          <span className="sr-only">
            : {good} logrado o avanzado, {grow} inicial o en desarrollo, {none} sin evidencia o no evaluados
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3" aria-hidden="true">
          <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
            <span className={cn("h-full", TONE_STYLE.good.bar)} style={{ width: pct(good) }} />
            <span className={cn("h-full", TONE_STYLE.grow.bar)} style={{ width: pct(grow) }} />
            <span className={cn("h-full", TONE_STYLE.none.bar)} style={{ width: pct(none) }} />
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tabular">
            <span className={cn("min-w-7 rounded-full px-2 py-0.5 text-center", good ? TONE_STYLE.good.tile : "bg-sunken text-text-3")}>{good}</span>
            <span className={cn("min-w-7 rounded-full px-2 py-0.5 text-center", grow ? TONE_STYLE.grow.tile : "bg-sunken text-text-3")}>{grow}</span>
            <span className="min-w-7 rounded-full bg-sunken px-2 py-0.5 text-center text-text-3">{none}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="grid gap-5 bg-paper/70 px-4 pt-2 pb-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-text-3 uppercase">Indicadores de avance</h4>
              <ul className="mt-1.5 space-y-1.5">
                {row.criteria.map((c) => (
                  <li key={c} className="flex gap-2 text-sm leading-6 text-text">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-lilac" aria-hidden="true" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold tracking-wide text-text-3 uppercase">Niveles</h4>
              <dl className="mt-1.5 space-y-1.5">
                {SKILL_LEVELS.map((l) => (
                  <div key={l} className="flex items-start gap-2 text-sm leading-5">
                    <dt className="w-24 shrink-0 font-semibold text-text">
                      {STATUS_LABELS[l]} <span className="font-normal text-text-3 tabular">· {row.counts[l]}</span>
                    </dt>
                    <dd className="text-text-2">{LEVEL_RUBRIC[l]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <Students entries={row.students} notEvaluated={row.counts.no_evaluado} />
        </div>
      ) : null}
    </li>
  );
}

function Students({ entries, notEvaluated }: { entries: SkillStudentEntry[]; notEvaluated: number }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="grid content-start gap-3">
      <h4 className="text-xs font-semibold tracking-wide text-text-3 uppercase">Alumnos · tocá uno para ver su evidencia</h4>
      {ORDER.map((status) => {
        const list = entries.filter((e) => e.status === status);
        if (!list.length) return null;
        return (
          <div key={status}>
            <LevelPill status={status} />
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {list.map((e) => (
                <li key={e.sessionId}>
                  <button
                    type="button"
                    aria-expanded={shown === e.sessionId}
                    onClick={() => setShown((x) => (x === e.sessionId ? null : e.sessionId))}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-sm font-semibold transition-colors max-sm:min-h-11",
                      shown === e.sessionId ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text hover:border-ink/40",
                    )}
                  >
                    {e.studentName}
                  </button>
                </li>
              ))}
            </ul>
            {list.some((e) => e.sessionId === shown) ? (
              <EvidenceCard
                className="mt-3"
                a={list.find((e) => e.sessionId === shown)!}
                footer={
                  <Link
                    to="/app/sesiones/$sessionId"
                    params={{ sessionId: shown! }}
                    search={{ tab: "evaluacion" }}
                    className="text-sm font-semibold text-ink underline decoration-lilac underline-offset-4"
                  >
                    Ver el trabajo completo
                  </Link>
                }
              />
            ) : null}
          </div>
        );
      })}
      {notEvaluated ? (
        <p className="text-sm text-text-3">
          {plural(notEvaluated, "trabajo no evaluó", "trabajos no evaluaron")} esta habilidad (se analizaron antes de elegirla o la actividad no la permite).
        </p>
      ) : null}
    </div>
  );
}

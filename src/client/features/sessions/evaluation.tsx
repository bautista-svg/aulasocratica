// "Evaluación" tab: the rubric (the AI only suggests when asked; the teacher picks the
// levels and confirms) and the AI summary based on the rubric and/or the objectives.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, Pencil, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Checkbox } from "@client/components/ui/controls";
import { Field, FormError, Textarea } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import { fmtDateTime, plural } from "@client/lib/format";
import { SUMMARY_BASIS_LABELS, type SummaryBasis } from "@shared/domain/session-summary";
import type { SessionDetail } from "@shared/contracts/sessions";
import { useSessionMutations } from "./api";

export function EvaluationTab({ detail }: { detail: SessionDetail }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <RubricCard detail={detail} />
      <SummaryCard detail={detail} />
    </div>
  );
}

function Card({ title, badge, children, id }: { title: string; badge?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-lg font-semibold text-ink">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function RubricCard({ detail }: { detail: SessionDetail }) {
  const a = detail.rubric;
  const m = useSessionMutations(detail.session.id);
  const [levels, setLevels] = useState<Record<string, number>>(a.teacherLevels);
  const [comment, setComment] = useState(a.comment);
  const [editing, setEditing] = useState(a.status !== "confirmed");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Server state changed (saved elsewhere / refreshed): adopt it unless there are local edits.
  const serverKey = JSON.stringify([a.teacherLevels, a.comment, a.status]);
  const dirty = JSON.stringify(levels) !== JSON.stringify(a.teacherLevels) || comment !== a.comment;
  useEffect(() => {
    if (!dirty) {
      setLevels(a.teacherLevels);
      setComment(a.comment);
      setEditing(a.status !== "confirmed");
    }
  }, [serverKey]);

  const suggestion = useMemo(() => new Map((a.suggestion ?? []).map((s) => [s.criterionId, s])), [a.suggestion]);
  const confirmed = a.status === "confirmed";
  const readOnly = confirmed && !editing;

  if (a.rubric.length === 0) {
    return (
      <Card id="rubric-title" title="Rúbrica">
        <p className="text-[15px] text-text-2">
          Esta actividad no tiene rúbrica.{" "}
          <Link to="/app/actividades/$activityId" params={{ activityId: detail.activity.id }} className="font-semibold text-ink underline underline-offset-4">
            Creala desde la actividad
          </Link>{" "}
          para evaluar con criterios.
        </p>
      </Card>
    );
  }

  const unpicked = a.rubric.filter((c) => levels[c.id] === undefined && suggestion.get(c.id)?.levelIndex != null);

  const save = (confirm: boolean) => {
    setError(null);
    setFieldErrors({});
    m.saveRubric.mutate(
      { levels, comment, confirm },
      {
        onSuccess: () => {
          toast.success(confirm ? "Evaluación confirmada" : "Borrador guardado");
          if (confirm) setEditing(false);
        },
        onError: (e) => {
          setError(errorMessage(e));
          setFieldErrors(e instanceof ApiError ? e.fields : {});
        },
      },
    );
  };

  return (
    <Card
      id="rubric-title"
      title="Rúbrica"
      badge={
        confirmed ? (
          <Badge tone="leaf">
            <CheckCircle2 className="size-3" aria-hidden="true" /> Confirmada por vos
          </Badge>
        ) : a.status === "draft" ? (
          <Badge tone="amber">Sin confirmar</Badge>
        ) : (
          <Badge tone="neutral">Sin evaluar</Badge>
        )
      }
    >
      {a.rubricChanged ? (
        <p className="mb-3 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber">
          La rúbrica de la actividad cambió después de empezar esta evaluación. Se muestra la versión con la que evaluaste.
        </p>
      ) : null}

      <div className="mb-4 rounded-md bg-lilac-soft/60 px-4 py-3 text-sm text-text-2">
        <p>
          La IA puede sugerir un nivel por criterio con una cita de lo que escribió el alumno. Solo corre cuando la pedís y nunca cambia los niveles que
          elegiste.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="lilac"
            icon={a.suggestion ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
            loading={m.suggestRubric.isPending}
            disabled={confirmed}
            onClick={() => {
              setError(null);
              m.suggestRubric.mutate(undefined, {
                onSuccess: (r) =>
                  toast.success(r.droppedQuotes ? `Sugerencia lista. Quitamos ${plural(r.droppedQuotes, "cita", "citas")} que el alumno no escribió.` : "Sugerencia lista"),
                onError: (e) => setError(errorMessage(e)),
              });
            }}
          >
            {a.suggestion ? "Volver a pedir sugerencia" : "Pedir sugerencia a la IA"}
          </Button>
          {a.aiGeneratedAt ? <span className="text-xs text-text-3">Última sugerencia: {fmtDateTime(a.aiGeneratedAt)}</span> : null}
        </div>
        {m.suggestRubric.isPending ? (
          <p role="status" className="mt-2 text-sm text-lilac-ink">
            La IA está leyendo el trabajo completo del alumno…
          </p>
        ) : null}
      </div>

      <div className="space-y-5">
        {a.rubric.map((c) => {
          const chosen = levels[c.id];
          const s = suggestion.get(c.id);
          return (
            <fieldset key={c.id} className="min-w-0">
              <legend className="text-[15px] font-semibold text-text">{c.name}</legend>
              {c.description ? <p className="mt-0.5 text-sm text-text-2">{c.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.levels.map((l, li) => (
                  <button
                    key={li}
                    type="button"
                    aria-pressed={chosen === li}
                    disabled={readOnly}
                    onClick={() => setLevels((x) => ({ ...x, [c.id]: li }))}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                      chosen === li ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text hover:border-ink/40",
                      readOnly && "cursor-default",
                    )}
                  >
                    {l.label}
                    {s?.levelIndex === li ? (
                      <Sparkles className={cn("size-3.5", chosen === li ? "text-white" : "text-lilac-ink")} aria-label="(sugerido por la IA)" />
                    ) : null}
                  </button>
                ))}
              </div>
              {chosen !== undefined && c.levels[chosen]?.description ? (
                <p className="mt-1.5 text-sm text-text-2">
                  <span className="font-semibold">{c.levels[chosen]!.label}:</span> {c.levels[chosen]!.description}
                </p>
              ) : null}
              {fieldErrors[`levels.${c.id}`] ? <p className="mt-1 text-[13px] font-medium text-rose">{fieldErrors[`levels.${c.id}`]}</p> : null}
              {s ? (
                <div className="mt-2 rounded-md border border-lilac/40 bg-lilac-soft/50 px-3 py-2 text-sm">
                  <p className="font-semibold text-lilac-ink">
                    Sugerencia de la IA: {s.levelIndex != null ? `«${c.levels[s.levelIndex]?.label ?? "—"}»` : "sin evidencia suficiente para elegir un nivel"}
                  </p>
                  {s.evidence ? <blockquote className="mt-1 border-l-2 border-lilac pl-2 text-text-2 italic">«{s.evidence}»</blockquote> : null}
                  {s.rationale ? <p className="mt-1 text-text-2">{s.rationale}</p> : null}
                  {s.evidenceDropped ? <p className="mt-1 text-xs text-text-3">La IA citó un texto que el alumno no escribió; lo quitamos.</p> : null}
                </div>
              ) : null}
            </fieldset>
          );
        })}

        {unpicked.length && !readOnly ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Wand2 className="size-4" />}
            onClick={() =>
              setLevels((x) => {
                const next = { ...x };
                for (const c of unpicked) next[c.id] = suggestion.get(c.id)!.levelIndex!;
                return next;
              })
            }
          >
            Usar la sugerencia en {plural(unpicked.length, "criterio sin nivel", "criterios sin nivel")}
          </Button>
        ) : null}

        <Field label="Tu comentario" optional counter={{ value: comment.length, max: 2000 }}>
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} value={comment} disabled={readOnly} maxLength={2000} minRows={2} onChange={(e) => setComment(e.target.value)} />
          )}
        </Field>

        <FormError message={error} />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {readOnly ? (
            <>
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar evaluación
              </Button>
              {a.confirmedAt ? <p className="text-sm text-text-3">Confirmada el {fmtDateTime(a.confirmedAt)}.</p> : null}
            </>
          ) : (
            <>
              <Button icon={<CheckCircle2 className="size-4" />} loading={m.saveRubric.isPending && m.saveRubric.variables?.confirm === true} disabled={m.saveRubric.isPending} onClick={() => save(true)}>
                Confirmar evaluación
              </Button>
              <Button variant="secondary" loading={m.saveRubric.isPending && m.saveRubric.variables?.confirm === false} disabled={m.saveRubric.isPending || (!dirty && a.status !== "confirmed")} onClick={() => save(false)}>
                {confirmed ? "Guardar sin confirmar" : "Guardar borrador"}
              </Button>
              {dirty ? <span className="text-sm text-amber">Tenés cambios sin guardar.</span> : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function SummaryCard({ detail }: { detail: SessionDetail }) {
  const m = useSessionMutations(detail.session.id);
  const avail = detail.summaryAvailable;
  const s = detail.summary;
  const [basis, setBasis] = useState<SummaryBasis[]>(() => {
    if (s?.basis.length) return s.basis;
    return (["rubric", "objectives"] as SummaryBasis[]).filter((b) => avail[b]);
  });
  const [error, setError] = useState<string | null>(null);
  const none = !avail.rubric && !avail.objectives;

  return (
    <Card
      id="summary-title"
      title="Resumen de la IA"
      badge={
        <Badge tone="lilac">
          <Sparkles className="size-3" aria-hidden="true" /> Inferencia de la IA
        </Badge>
      }
    >
      <p className="text-sm text-text-2">Una lectura de la IA sobre el trabajo del alumno, con citas textuales suyas. Revisala antes de usarla.</p>
      {none ? (
        <p className="mt-3 text-[15px] text-text-2">
          Para resumir hace falta que la actividad tenga rúbrica u objetivos.{" "}
          <Link to="/app/actividades/$activityId" params={{ activityId: detail.activity.id }} className="font-semibold text-ink underline underline-offset-4">
            Cargalos en la actividad
          </Link>
          .
        </p>
      ) : (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-text">Basar el resumen en</legend>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(["rubric", "objectives"] as SummaryBasis[]).map((b) => (
              <Checkbox
                key={b}
                checked={basis.includes(b)}
                disabled={!avail[b]}
                onCheckedChange={(v) => setBasis((x) => (v ? [...new Set([...x, b])] : x.filter((y) => y !== b)))}
                label={SUMMARY_BASIS_LABELS[b]}
                description={!avail[b] ? (b === "rubric" ? "La actividad no tiene rúbrica." : "La actividad no tiene objetivos.") : undefined}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="lilac"
              icon={s ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              loading={m.summarize.isPending}
              disabled={basis.length === 0}
              onClick={() => {
                setError(null);
                m.summarize.mutate(basis, { onSuccess: () => toast.success("Resumen listo"), onError: (e) => setError(errorMessage(e)) });
              }}
            >
              {s ? "Volver a resumir" : "Resumir"}
            </Button>
            {basis.length === 0 ? <span className="text-sm text-text-3">Elegí al menos una opción.</span> : null}
          </div>
          {m.summarize.isPending ? (
            <p role="status" className="mt-2 text-sm text-lilac-ink">
              La IA está leyendo el trabajo completo del alumno…
            </p>
          ) : null}
        </fieldset>
      )}
      <div className="mt-3">
        <FormError message={error} />
      </div>

      {s ? (
        <div className="mt-5 space-y-5 border-t border-line pt-5" aria-live="polite">
          <p className="text-xs text-text-3">
            Generado el {fmtDateTime(s.generatedAt)} · según {s.basis.map((b) => SUMMARY_BASIS_LABELS[b].toLowerCase()).join(" y ")}
            {s.omittedMessages ? ` · por la extensión, la IA no leyó ${plural(s.omittedMessages, "mensaje intermedio", "mensajes intermedios")}` : ""}
            {s.droppedQuotes ? ` · se quitaron ${plural(s.droppedQuotes, "cita", "citas")} que el alumno no escribió` : ""}
          </p>
          {s.content.overview ? <p className="text-[15px] leading-7 text-text">{s.content.overview}</p> : null}
          <Points title="Según la rúbrica" points={s.content.criteria} />
          <Points title="Según los objetivos" points={s.content.objectives} />
          {s.content.nextSteps.length ? (
            <div>
              <h3 className="text-sm font-semibold text-text">Próximos pasos sugeridos</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-text-2">
                {s.content.nextSteps.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Points({ title, points }: { title: string; points: { title: string; observation: string; evidence: string[] }[] }) {
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

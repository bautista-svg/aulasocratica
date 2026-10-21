// "Entrega del alumno" (Evaluación tab): the file the student handed in, how it was read, and the
// AI's rubric-based reading of it (only when the teacher asks; the levels are a suggestion the
// teacher can bring into the evaluation and then change).
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Download, ExternalLink, FileText, ImageIcon, Paperclip, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Spinner } from "@client/components/ui/spinner";
import { FormError } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { fmtDateTime, plural } from "@client/lib/format";
import { KIND_LABEL, formatBytes } from "@shared/domain/files";
import type { SessionDetail } from "@shared/contracts/sessions";
import { useState } from "react";
import { useSessionMutations } from "./api";

export function DeliverableCard({ detail, onUseLevels }: { detail: SessionDetail; onUseLevels: (levels: Record<string, number>) => void }) {
  const d = detail.deliverable;
  const m = useSessionMutations(detail.session.id);
  const [error, setError] = useState<string | null>(null);
  const required = detail.activity.deliverableMode === "required";
  const hasRubric = detail.activity.rubric.length > 0;

  return (
    <section aria-labelledby="entrega-title" className="rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6 xl:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="entrega-title" className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Paperclip className="size-[18px] text-lilac-ink" aria-hidden="true" />
          Entrega del alumno
        </h2>
        <Badge tone="neutral">{required ? "Obligatoria" : "Opcional"}</Badge>
      </div>
      {detail.activity.deliverablePrompt ? (
        <p className="mb-4 text-sm text-text-2">
          <span className="font-semibold text-text">Lo que pediste:</span> {detail.activity.deliverablePrompt}
        </p>
      ) : null}

      {!d ? (
        <p className="rounded-md border border-dashed border-line-strong bg-paper px-4 py-3 text-[15px] text-text-2">
          {detail.session.status === "completed" ? "No subió ningún archivo." : "Todavía no subió ningún archivo."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-md border border-line bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex min-w-0 items-center gap-3">
              {d.kind === "image" ? (
                <ImageIcon className="size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
              ) : (
                <FileText className="size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold text-text">{d.fileName}</span>
                <span className="block text-sm text-text-3">
                  {KIND_LABEL[d.kind]} · {formatBytes(d.sizeBytes)}
                  {d.pageCount ? ` · ${plural(d.pageCount, "página", "páginas")}` : ""} · subido el {fmtDateTime(d.uploadedAt)}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 gap-2">
              <a href={d.url} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                <ExternalLink className="size-4" aria-hidden="true" />
                Abrir
              </a>
              <a href={`${d.url}?download=1`} className={buttonClass("ghost", "sm")}>
                <Download className="size-4" aria-hidden="true" />
                Descargar
              </a>
            </span>
          </div>

          {d.processingStatus === "pending" || d.processingStatus === "processing" ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-sm text-text-2">
              <Spinner className="size-4" /> Leyendo el archivo… Cuando termine lo podés analizar con la rúbrica.
            </p>
          ) : d.processingStatus === "failed" ? (
            <div className="mt-3 flex flex-col gap-2 rounded-md bg-rose-soft px-4 py-3 text-sm text-rose sm:flex-row sm:items-center sm:justify-between">
              <span>{d.processingError ?? "No se pudo leer el archivo."}</span>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="size-4" />}
                loading={m.retryDeliverable.isPending}
                onClick={() => m.retryDeliverable.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}
              >
                Reintentar la lectura
              </Button>
            </div>
          ) : d.processingError ? (
            <p className="mt-2 text-xs text-text-3">{d.processingError}</p>
          ) : null}

          <div className="mt-4 rounded-md bg-lilac-soft/60 px-4 py-3 text-sm text-text-2">
            {hasRubric ? (
              <p>
                La IA puede leer el archivo con la rúbrica de la actividad y sugerir un nivel por criterio, con evidencia del archivo. Solo corre cuando la
                pedís; vos decidís los niveles.
              </p>
            ) : (
              <p>
                Para analizar la entrega con la rúbrica, la actividad tiene que tener una.{" "}
                <Link to="/app/actividades/$activityId" params={{ activityId: detail.activity.id }} className="font-semibold text-ink underline underline-offset-4">
                  Creala desde la actividad
                </Link>
                .
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="lilac"
                icon={d.analysis ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
                loading={m.analyzeDeliverable.isPending}
                disabled={!hasRubric || d.processingStatus !== "ready"}
                onClick={() => {
                  setError(null);
                  m.analyzeDeliverable.mutate(undefined, {
                    onSuccess: () => toast.success("Análisis de la entrega listo"),
                    onError: (e) => setError(errorMessage(e)),
                  });
                }}
              >
                {d.analysis ? "Volver a analizar" : "Analizar con la rúbrica"}
              </Button>
              {d.analysis ? <span className="text-xs text-text-3">Último análisis: {fmtDateTime(d.analysis.generatedAt)}</span> : null}
            </div>
            {m.analyzeDeliverable.isPending ? (
              <p role="status" className="mt-2 text-sm text-lilac-ink">
                La IA está leyendo el archivo…
              </p>
            ) : null}
          </div>
          <div className="mt-2">
            <FormError message={error} />
          </div>

          {d.analysis ? <AnalysisView detail={detail} onUseLevels={onUseLevels} /> : null}
        </>
      )}
    </section>
  );
}

function AnalysisView({ detail, onUseLevels }: { detail: SessionDetail; onUseLevels: (levels: Record<string, number>) => void }) {
  const a = detail.deliverable!.analysis!;
  // Levels can only be brought into the evaluation for criteria that still exist with that level.
  const target = detail.rubric.rubric;
  const usable: Record<string, number> = {};
  for (const item of a.criteria) {
    const c = target.find((x) => x.id === item.criterionId);
    if (c && item.levelIndex != null && item.levelIndex < c.levels.length) usable[item.criterionId] = item.levelIndex;
  }
  const count = Object.keys(usable).length;

  return (
    <div className="mt-5 space-y-5 border-t border-line pt-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="lilac">
          <Sparkles className="size-3" aria-hidden="true" /> Sugerencia de la IA
        </Badge>
        <span className="text-sm text-text-3">Revisala antes de usarla.</span>
      </div>
      {a.overview ? <p className="text-[15px] leading-7 text-text">{a.overview}</p> : null}

      <ul className="grid gap-3 lg:grid-cols-2">
        {a.criteria.map((item) => {
          const c = a.rubric.find((x) => x.id === item.criterionId);
          if (!c) return null;
          const level = item.levelIndex != null ? c.levels[item.levelIndex] : undefined;
          return (
            <li key={item.criterionId} className="rounded-md border border-line bg-paper px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{c.name}</span>
                {level ? <Badge tone="ink">{level.label}</Badge> : <Badge tone="neutral">Sin evidencia suficiente</Badge>}
              </p>
              {item.evidence ? (
                item.evidenceKind === "quote" ? (
                  <blockquote className="mt-2 border-l-2 border-lilac pl-3 text-sm text-text-2 italic">«{item.evidence}»</blockquote>
                ) : (
                  <p className="mt-2 border-l-2 border-lilac pl-3 text-sm text-text-2">
                    <span className="font-semibold">Lo que se ve en la foto:</span> {item.evidence}
                  </p>
                )
              ) : null}
              {item.rationale ? <p className="mt-1.5 text-sm text-text-2">{item.rationale}</p> : null}
              {item.evidenceDropped ? <p className="mt-1 text-xs text-text-3">La IA citó un texto que no está en el archivo; lo quitamos.</p> : null}
            </li>
          );
        })}
      </ul>

      {a.strengths || a.improvements ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {a.strengths ? (
            <div className="rounded-md bg-leaf-soft px-4 py-3">
              <h3 className="text-sm font-semibold text-leaf">Lo que muestra bien</h3>
              <p className="mt-1 text-[15px] leading-6 text-text">{a.strengths}</p>
            </div>
          ) : null}
          {a.improvements ? (
            <div className="rounded-md bg-amber-soft px-4 py-3">
              <h3 className="text-sm font-semibold text-amber">Lo que le falta</h3>
              <p className="mt-1 text-[15px] leading-6 text-text">{a.improvements}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {count ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="secondary" icon={<Wand2 className="size-4" />} onClick={() => onUseLevels(usable)}>
            Usar estos niveles en la evaluación
          </Button>
          <span className="text-sm text-text-3">Los ponemos en la rúbrica de abajo para que los revises y confirmes.</span>
        </div>
      ) : null}
    </div>
  );
}

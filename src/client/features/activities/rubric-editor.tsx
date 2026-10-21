// Rubric of an activity: criteria with 2–5 levels each. Proposals from the AI and rubrics
// read from a file arrive as a suggestion the teacher reviews before using; nothing is
// stored until "Guardar cambios".
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileUp, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Input, Textarea } from "@client/components/ui/field";
import { Spinner } from "@client/components/ui/spinner";
import { FormError } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { errorMessage } from "@client/lib/api";
import {
  MAX_CRITERIA,
  MAX_LEVELS,
  MAX_RUBRIC_UPLOAD_BYTES,
  MIN_LEVELS,
  RUBRIC_UPLOAD_ACCEPT,
  emptyCriterion,
  rubricUploadKind,
  type RubricCriterion,
} from "@shared/domain/activity-design";
import type { AiRubricInput } from "@shared/contracts/activities";
import { useAiDesign } from "./api";
import { AiRequest } from "./ai-request";
import { SuggestionBox } from "./parts";
import { prepareImage } from "./prepare-image";
import type { ActivityForm } from "./use-activity-form";

type Suggestion = { source: "ai" | "import"; criteria: RubricCriterion[]; truncated?: boolean; fileName?: string };

export function RubricEditor({ activityId, form, context }: { activityId: string; form: ActivityForm; context: AiRubricInput["context"] }) {
  const { draft, set, errors } = form;
  const items = draft.rubric;
  const ai = useAiDesign(activityId);
  const [asking, setAsking] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (next: RubricCriterion[]) => set("rubric", next);
  const patch = (i: number, p: Partial<RubricCriterion>) => update(items.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    update(next);
  };
  const err = (path: string) => errors[path];

  async function importFile(file: File) {
    setImportError(null);
    const kind = rubricUploadKind(file.name, file.type);
    if (!kind) return setImportError("Subí la rúbrica en PDF, Word (.docx), foto (JPG, PNG o WEBP) o texto.");
    const ready = kind === "image" ? await prepareImage(file) : file;
    if (ready.size > MAX_RUBRIC_UPLOAD_BYTES) return setImportError("El archivo pesa más de 8 MB. Probá con uno más liviano.");
    ai.importRubric.mutate(ready, {
      onSuccess: (r) => setSuggestion({ source: "import", criteria: r.criteria, truncated: r.truncated, fileName: file.name }),
      onError: (e) => setImportError(errorMessage(e)),
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function use(mode: "append" | "replace") {
    if (!suggestion) return;
    const next = mode === "append" ? [...items, ...suggestion.criteria].slice(0, MAX_CRITERIA) : suggestion.criteria;
    update(next.map((c) => ({ ...c, levels: c.levels.map((l) => ({ ...l })) })));
    setSuggestion(null);
    toast.success("Sugerencia aplicada. Revisala y tocá «Guardar cambios».");
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="lilac" icon={<Sparkles className="size-4" />} onClick={() => setAsking(true)} disabled={asking || ai.rubric.isPending}>
          Proponer con IA
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={RUBRIC_UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
          }}
        />
        <Button variant="secondary" icon={<FileUp className="size-4" />} loading={ai.importRubric.isPending} onClick={() => fileRef.current?.click()}>
          Importar desde un archivo
        </Button>
      </div>
      <p className="-mt-1 text-[13px] leading-5 text-text-3">
        ¿Ya tenés una rúbrica? Subila en PDF, foto o Word y la pasamos al editor tal como está, para que la revises.
      </p>
      <div aria-live="polite">
        {ai.importRubric.isPending ? <Spinner label="Leyendo la rúbrica…" /> : null}
        <FormError message={importError} />
      </div>

      {asking ? (
        <AiRequest
          noun={{ one: "criterio", many: "criterios" }}
          max={MAX_CRITERIA}
          defaultCount={3}
          pending={ai.rubric.isPending}
          error={ai.rubric.error}
          onCancel={() => {
            setAsking(false);
            ai.rubric.reset();
          }}
          onSubmit={({ request, count }) =>
            ai.rubric.mutate(
              { request: request || undefined, count, existing: items.map((c) => c.name).filter(Boolean), context },
              {
                onSuccess: (r) => {
                  setSuggestion({ source: "ai", criteria: r.criteria });
                  setAsking(false);
                },
              },
            )
          }
        />
      ) : null}

      {suggestion ? (
        <SuggestionBox
          title={suggestion.source === "import" ? "Sugerencia de la IA · rúbrica leída del archivo" : "Sugerencia de la IA"}
          note={
            suggestion.source === "import"
              ? `Transcripción de «${suggestion.fileName}». Compará con el original antes de usarla.${suggestion.truncated ? ` Tenía más de ${MAX_CRITERIA} criterios: trajimos los primeros ${MAX_CRITERIA}.` : ""}`
              : "Revisala: podés usarla y después editar cada criterio."
          }
          actions={
            <>
              {suggestion.source === "ai" && items.length > 0 ? (
                <>
                  <Button onClick={() => use("append")} disabled={items.length >= MAX_CRITERIA}>
                    Usar: agregar a la rúbrica
                  </Button>
                  <Button variant="secondary" onClick={() => use("replace")}>
                    Usar en lugar de la actual
                  </Button>
                </>
              ) : (
                <Button onClick={() => use("replace")}>{items.length > 0 ? "Usar (reemplaza la actual)" : "Usar"}</Button>
              )}
              <Button variant="ghost" onClick={() => setSuggestion(null)}>
                Descartar
              </Button>
            </>
          }
        >
          <ol className="space-y-3">
            {suggestion.criteria.map((c, i) => (
              <li key={c.id} className="rounded-md bg-surface px-3.5 py-3">
                <p className="text-sm font-semibold text-text">
                  {i + 1}. {c.name}
                </p>
                {c.description ? <p className="mt-0.5 text-[13px] text-text-2">{c.description}</p> : null}
                <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {c.levels.map((l, j) => (
                    <div key={j} className="text-[13px] leading-5">
                      <dt className="inline font-semibold text-ink">{l.label}: </dt>
                      <dd className="inline text-text-2">{l.description || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        </SuggestionBox>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-2">
          Todavía no hay criterios. Agregá uno, pedile una propuesta a la IA o importá tu rúbrica.
        </p>
      ) : (
        <ol className="grid gap-3">
          {items.map((c, i) => (
            <li key={c.id} className="rounded-md border border-line bg-paper/60 p-3.5 sm:p-4">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-soft text-xs font-semibold text-ink" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,240px)_1fr]">
                  <div>
                    <label htmlFor={`crit-${c.id}-name`} className="sr-only">
                      Nombre del criterio {i + 1}
                    </label>
                    <Input
                      id={`crit-${c.id}-name`}
                      value={c.name}
                      maxLength={120}
                      placeholder="Nombre del criterio"
                      invalid={Boolean(err(`rubric.${i}.name`))}
                      aria-describedby={err(`rubric.${i}.name`) ? `crit-${c.id}-name-err` : undefined}
                      onChange={(e) => patch(i, { name: e.target.value })}
                    />
                    {err(`rubric.${i}.name`) ? (
                      <p id={`crit-${c.id}-name-err`} className="mt-1 text-[13px] font-medium text-rose">
                        {err(`rubric.${i}.name`)}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor={`crit-${c.id}-desc`} className="sr-only">
                      Qué se mira en el criterio {i + 1}
                    </label>
                    <Input
                      id={`crit-${c.id}-desc`}
                      value={c.description}
                      maxLength={500}
                      placeholder="Qué se mira (opcional)"
                      onChange={(e) => patch(i, { description: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-1 flex justify-end gap-1">
                <Button variant="ghost" size="icon" aria-label={`Subir el criterio ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Bajar el criterio ${i + 1}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Borrar el criterio ${i + 1}`} onClick={() => update(items.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className={cn("mt-1 grid gap-2 sm:grid-cols-2", c.levels.length >= 4 && "xl:grid-cols-4", c.levels.length === 3 && "xl:grid-cols-3")}>
                {c.levels.map((l, j) => (
                  <div key={j} className="rounded-md border border-line bg-surface p-2.5">
                    <label htmlFor={`crit-${c.id}-lv${j}`} className="sr-only">
                      Nombre del nivel {j + 1} del criterio {i + 1}
                    </label>
                    <Input
                      id={`crit-${c.id}-lv${j}`}
                      value={l.label}
                      maxLength={40}
                      className="h-10 font-semibold"
                      invalid={Boolean(err(`rubric.${i}.levels.${j}.label`))}
                      onChange={(e) => patch(i, { levels: c.levels.map((x, k) => (k === j ? { ...x, label: e.target.value } : x)) })}
                    />
                    {err(`rubric.${i}.levels.${j}.label`) ? (
                      <p className="mt-1 text-[13px] font-medium text-rose">{err(`rubric.${i}.levels.${j}.label`)}</p>
                    ) : null}
                    <label htmlFor={`crit-${c.id}-lv${j}-d`} className="sr-only">
                      Qué se observa en el nivel {j + 1} del criterio {i + 1}
                    </label>
                    <Textarea
                      id={`crit-${c.id}-lv${j}-d`}
                      value={l.description}
                      maxLength={500}
                      minRows={2}
                      maxRows={6}
                      placeholder="Qué se observa en este nivel"
                      className="mt-2 text-sm"
                      onChange={(e) => patch(i, { levels: c.levels.map((x, k) => (k === j ? { ...x, description: e.target.value } : x)) })}
                    />
                  </div>
                ))}
              </div>
              {err(`rubric.${i}.levels`) ? <p className="mt-1.5 text-[13px] font-medium text-rose">{err(`rubric.${i}.levels`)}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="size-4" />}
                  disabled={c.levels.length >= MAX_LEVELS}
                  onClick={() => patch(i, { levels: [...c.levels, { label: `Nivel ${c.levels.length + 1}`, description: "" }] })}
                  aria-label={`Agregar un nivel al criterio ${i + 1}`}
                >
                  Nivel
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Minus className="size-4" />}
                  disabled={c.levels.length <= MIN_LEVELS}
                  onClick={() => patch(i, { levels: c.levels.slice(0, -1) })}
                  aria-label={`Quitar el último nivel del criterio ${i + 1}`}
                >
                  Nivel
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {errors.rubric ? <p className="text-[13px] font-medium text-rose">{errors.rubric}</p> : null}
      <div>
        <Button variant="secondary" icon={<Plus className="size-4" />} disabled={items.length >= MAX_CRITERIA} onClick={() => update([...items, emptyCriterion()])}>
          Agregar criterio
        </Button>
        {items.length >= MAX_CRITERIA ? <p className="mt-1.5 text-[13px] text-text-3">Llegaste al máximo de {MAX_CRITERIA} criterios.</p> : null}
      </div>
    </div>
  );
}

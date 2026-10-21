// Final reflection questions (0–6). An empty list is a valid choice: the student then
// ends with the final answer only. Nothing is stored until "Guardar cambios".
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import {
  DEFAULT_REFLECTION_QUESTIONS,
  MAX_REFLECTION_QUESTIONS,
  newKey,
  type ReflectionQuestion,
} from "@shared/domain/activity-design";
import type { AiReflectionInput } from "@shared/contracts/activities";
import { useAiDesign } from "./api";
import { AiRequest } from "./ai-request";
import { SuggestionBox } from "./parts";
import type { ActivityForm } from "./use-activity-form";

export function ReflectionEditor({ activityId, form, context }: { activityId: string; form: ActivityForm; context: AiReflectionInput["context"] }) {
  const { draft, set, errors } = form;
  const items = draft.reflectionQuestions;
  const ai = useAiDesign(activityId);
  const [asking, setAsking] = useState(false);
  const [suggestion, setSuggestion] = useState<ReflectionQuestion[] | null>(null);

  const update = (next: ReflectionQuestion[]) => set("reflectionQuestions", next);
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    update(next);
  };
  const isDefault = JSON.stringify(items.map((q) => q.question)) === JSON.stringify(DEFAULT_REFLECTION_QUESTIONS.map((q) => q.question));

  function use(mode: "append" | "replace") {
    if (!suggestion) return;
    update((mode === "append" ? [...items, ...suggestion] : suggestion).slice(0, MAX_REFLECTION_QUESTIONS));
    setSuggestion(null);
    toast.success("Sugerencia aplicada. Revisala y tocá «Guardar cambios».");
  }

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-5 text-center text-sm leading-6 text-text-2">
          Sin preguntas de reflexión: al terminar, el alumno escribe solo su respuesta final.
        </p>
      ) : (
        <ol className="grid gap-2">
          {items.map((q, i) => {
            const error = errors[`reflectionQuestions.${i}.question`];
            return (
              <li key={q.key}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-1.5">
                  <div className="flex min-w-0 flex-1 items-start gap-1.5">
                    <span className="mt-2.5 w-5 shrink-0 text-right text-sm text-text-3 tabular" aria-hidden="true">
                      {i + 1}.
                    </span>
                    <label htmlFor={`refl-${q.key}`} className="sr-only">
                      Pregunta {i + 1}
                    </label>
                    <Textarea
                      id={`refl-${q.key}`}
                      value={q.question}
                      maxLength={300}
                      minRows={1}
                      rows={1}
                      maxRows={5}
                      invalid={Boolean(error)}
                      aria-describedby={error ? `refl-${q.key}-err` : undefined}
                      placeholder="Escribí la pregunta"
                      onChange={(e) => update(items.map((x, j) => (j === i ? { ...x, question: e.target.value.replace(/\n/g, " ") } : x)))}
                    />
                  </div>
                  <div className="flex shrink-0 justify-end">
                    <Button variant="ghost" size="icon" aria-label={`Subir la pregunta ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Bajar la pregunta ${i + 1}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Borrar la pregunta ${i + 1}`} onClick={() => update(items.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {error ? (
                  <p id={`refl-${q.key}-err`} className="mt-1 ml-7 text-[13px] font-medium text-rose">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {errors.reflectionQuestions ? <p className="text-[13px] font-medium text-rose">{errors.reflectionQuestions}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="secondary"
          icon={<Plus className="size-4" />}
          disabled={items.length >= MAX_REFLECTION_QUESTIONS}
          onClick={() => update([...items, { key: newKey(), question: "" }])}
        >
          Agregar pregunta
        </Button>
        <Button variant="lilac" icon={<Sparkles className="size-4" />} onClick={() => setAsking(true)} disabled={asking || ai.reflection.isPending}>
          Proponer con IA
        </Button>
        {!isDefault ? (
          <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => update(DEFAULT_REFLECTION_QUESTIONS.map((q) => ({ ...q })))}>
            Volver a las 2 sugeridas
          </Button>
        ) : null}
      </div>

      {asking ? (
        <AiRequest
          noun={{ one: "pregunta", many: "preguntas" }}
          max={MAX_REFLECTION_QUESTIONS}
          defaultCount={2}
          pending={ai.reflection.isPending}
          error={ai.reflection.error}
          onCancel={() => {
            setAsking(false);
            ai.reflection.reset();
          }}
          onSubmit={({ request, count }) =>
            ai.reflection.mutate(
              { request: request || undefined, count, existing: items.map((q) => q.question).filter(Boolean), context },
              {
                onSuccess: (r) => {
                  setSuggestion(r.questions);
                  setAsking(false);
                },
              },
            )
          }
        />
      ) : null}

      {suggestion ? (
        <SuggestionBox
          note="Revisalas: podés usarlas y después editar cada una."
          actions={
            <>
              {items.length > 0 ? (
                <>
                  <Button onClick={() => use("append")} disabled={items.length >= MAX_REFLECTION_QUESTIONS}>
                    Usar: agregar a las que tengo
                  </Button>
                  <Button variant="secondary" onClick={() => use("replace")}>
                    Usar en lugar de las actuales
                  </Button>
                </>
              ) : (
                <Button onClick={() => use("replace")}>Usar</Button>
              )}
              <Button variant="ghost" onClick={() => setSuggestion(null)}>
                Descartar
              </Button>
            </>
          }
        >
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-text">
            {suggestion.map((q) => (
              <li key={q.key}>{q.question}</li>
            ))}
          </ol>
        </SuggestionBox>
      ) : null}

      <p className="text-[13px] leading-5 text-text-3">
        Si cambiás las preguntas, los alumnos que ya terminaron conservan las que respondieron.
      </p>
    </div>
  );
}

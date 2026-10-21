import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, MoreHorizontal, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { Menu } from "@client/components/ui/controls";
import { Badge, ErrorState, Notice, Skeleton } from "@client/components/ui/misc";
import { ApiError, errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { DIFFICULTIES, MAX_TUTOR_RULES, TUTOR_TEMPLATES, composeTutorRules } from "@shared/domain/tutors";
import { HELP_LEVELS, TUTOR_TYPE_GUIDANCE, TUTOR_TYPES } from "@shared/domain/pedagogy";
import { presetValues } from "@shared/domain/tutor-presets";
import type { TutorDetail, TutorSummary } from "@shared/contracts/tutors";
import { useTutor, useTutorMutations } from "./api";
import { HelpLevelField, TutorTypeField } from "./tutor-fields";
import { TutorTypeTile } from "./tutor-visual";

export interface TutorValues {
  name: string;
  tutorType: string;
  helpLevel: "autonomous" | "moderate" | "intensive";
  difficulty: "basica" | "intermedia" | "avanzada";
  studentAge: string;
  objectives: string;
  questionStyle: string;
  strategies: string;
  closingCriteria: string;
  rules: string;
}

const LIMITS: Partial<Record<keyof TutorValues, number>> = {
  name: 120,
  studentAge: 60,
  objectives: 2000,
  questionStyle: 1000,
  strategies: 2000,
  closingCriteria: 1000,
  rules: 3000,
};

function newTutorValues(): TutorValues {
  const t = TUTOR_TEMPLATES.pensamiento_critico!;
  return {
    name: "",
    tutorType: "pensamiento_critico",
    helpLevel: "moderate",
    difficulty: "intermedia",
    studentAge: "",
    objectives: "",
    questionStyle: t.question_style,
    strategies: t.strategies,
    closingCriteria: t.closing_criteria,
    rules: "",
  };
}

function fromDetail(d: TutorDetail): TutorValues {
  return {
    name: d.name,
    tutorType: d.tutorType,
    helpLevel: d.helpLevel,
    difficulty: d.difficulty,
    studentAge: d.studentAge,
    objectives: d.objectives,
    questionStyle: d.questionStyle,
    strategies: d.strategies,
    closingCriteria: d.closingCriteria,
    rules: d.rules,
  };
}

/** The teacher indications the tutor receives from this configuration (same function the server uses). */
export function tutorRulesPreview(v: Pick<TutorValues, "studentAge" | "difficulty" | "objectives" | "questionStyle" | "strategies" | "closingCriteria" | "rules">) {
  const cfg = {
    student_age: v.studentAge,
    difficulty: v.difficulty,
    objectives: v.objectives,
    question_style: v.questionStyle,
    strategies: v.strategies,
    closing_criteria: v.closingCriteria,
    rules: v.rules,
  };
  const text = composeTutorRules(cfg);
  // Same parts as composeTutorRules, without its final cut, to tell the teacher when the end is lost.
  const fullLength = (
    [
      ["Edad de los estudiantes", v.studentAge],
      ["Dificultad", DIFFICULTIES[v.difficulty] ?? ""],
      ["Objetivos del tutor", v.objectives],
      ["Tipo de preguntas", v.questionStyle],
      ["Estrategias metacognitivas", v.strategies],
      ["Criterios de cierre", v.closingCriteria],
      ["Reglas del docente", v.rules],
    ] as const
  )
    .map(([label, s]) => [label, s.trim()] as const)
    .filter(([, s]) => s)
    .map(([label, s]) => `${label}: ${s}`)
    .join("\n").length;
  return { text, truncated: fullLength > MAX_TUTOR_RULES };
}

export function TutorEditorDialog({
  open,
  onOpenChange,
  tutorId,
  onUse,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = new tutor. */
  tutorId: string | null;
  onUse: (t: TutorSummary) => void;
  onCreated?: (t: TutorDetail) => void;
}) {
  const detail = useTutor(open ? tutorId : null);
  const m = useTutorMutations();
  const [values, setValues] = useState<TutorValues>(newTutorValues);
  const [initial, setInitial] = useState<TutorValues>(newTutorValues);
  const [confirm, setConfirm] = useState<null | "discard" | "restore" | "delete">(null);

  // Load the tutor into the form once per opening (refetches never overwrite what the teacher is typing).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setLoadedFor(null);
      return;
    }
    const key = tutorId ?? "new";
    if (loadedFor === key) return;
    if (!tutorId) {
      const v = newTutorValues();
      setValues(v);
      setInitial(v);
      setLoadedFor(key);
      m.create.reset();
    } else if (detail.data && detail.data.id === tutorId) {
      const v = fromDetail(detail.data);
      setValues(v);
      setInitial(v);
      setLoadedFor(key);
      m.update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tutorId, detail.data, loadedFor]);

  const tutor = tutorId ? detail.data : undefined;
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);
  const saving = m.create.isPending || m.update.isPending;
  const saveError = tutorId ? m.update.error : m.create.error;
  const fields = saveError instanceof ApiError ? saveError.fields : {};
  const preview = tutorRulesPreview(values);
  const loading = Boolean(tutorId) && loadedFor !== tutorId;

  const set = <K extends keyof TutorValues>(k: K, v: TutorValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  const changeType = (next: string) => {
    setValues((s) => {
      const oldT = TUTOR_TEMPLATES[s.tutorType];
      const newT = TUTOR_TEMPLATES[next];
      const swap = (cur: string, oldV?: string, newV?: string) => (!cur.trim() || cur === oldV ? (newV ?? cur) : cur);
      return {
        ...s,
        tutorType: next,
        questionStyle: swap(s.questionStyle, oldT?.question_style, newT?.question_style),
        strategies: swap(s.strategies, oldT?.strategies, newT?.strategies),
        closingCriteria: swap(s.closingCriteria, oldT?.closing_criteria, newT?.closing_criteria),
      };
    });
  };

  const requestClose = (o: boolean) => {
    if (!o && dirty && !saving) {
      setConfirm("discard");
      return;
    }
    onOpenChange(o);
  };

  const save = () => {
    if (!values.name.trim()) return;
    if (tutorId) {
      m.update.mutate(
        { id: tutorId, data: values },
        {
          onSuccess: (r) => {
            const v = fromDetail(r.tutor);
            setValues(v);
            setInitial(v);
            toast.success("Cambios guardados");
            onOpenChange(false);
          },
        },
      );
    } else {
      m.create.mutate(values, {
        onSuccess: (r) => {
          setInitial(values);
          toast.success("Tutor creado");
          onOpenChange(false);
          onCreated?.(r.tutor);
        },
      });
    }
  };

  const isPreset = Boolean(tutor?.presetKey);
  const original = tutor?.presetKey ? presetValues(tutor.presetKey) : null;

  const title = tutorId ? (tutor ? `Editar «${tutor.name}»` : "Editar tutor") : "Nuevo tutor";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={requestClose}
        wide
        title={title}
        description={
          tutor
            ? [
                isPreset ? "Incluido en la app" : "Creado por vos",
                tutor.usedInActivities ? plural(tutor.usedInActivities, "actividad lo usa", "actividades lo usan") : "Ninguna actividad lo usa todavía",
              ].join(" · ")
            : "Configurá cómo conversa la IA con tus alumnos. Podés usarlo en cualquier actividad."
        }
        footer={
          <>
            {tutor ? (
              <div className="sm:mr-auto">
                <Menu
                  align="start"
                  trigger={
                    <Button variant="ghost" className="w-full sm:w-auto" icon={<MoreHorizontal className="size-4" />}>
                      Más acciones
                    </Button>
                  }
                  items={[
                    { label: "Usar en una actividad nueva", icon: <Sparkles className="size-4" />, onSelect: () => onUse(tutor), disabled: dirty },
                    { label: "Duplicar", icon: <Copy className="size-4" />, onSelect: () => duplicate(tutor.id) },
                    ...(isPreset
                      ? [{ label: "Restaurar original", icon: <RotateCcw className="size-4" />, onSelect: () => setConfirm("restore") }]
                      : ["separator" as const, { label: "Eliminar", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirm("delete") }]),
                  ]}
                />
              </div>
            ) : null}
            <Button variant="secondary" onClick={() => requestClose(false)}>
              Cancelar
            </Button>
            <Button loading={saving} disabled={loading || !values.name.trim() || (Boolean(tutorId) && !dirty)} onClick={save}>
              {tutorId ? "Guardar cambios" : "Crear tutor"}
            </Button>
          </>
        }
      >
        {tutorId && detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : loading ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Cargando tutor">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {tutor?.customized ? (
              <Notice tone="lilac" title="Editaste este tutor">
                Si querés volver a los textos con los que viene la app, usá «Restaurar original» en Más acciones.
              </Notice>
            ) : null}

            <Field label="Nombre" error={fields.name} hint="Solo lo ves vos: sirve para reconocerlo en tus listas. Los alumnos no lo ven.">
              {(p) => (
                <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={LIMITS.name} autoFocus={!tutorId} />
              )}
            </Field>

            <Field label="Tipo de tutor" error={fields.tutorType}>
              {(p) => <TutorTypeField id={p.id} describedBy={p.describedBy} value={values.tutorType} onChange={changeType} />}
            </Field>

            <HelpLevelField value={values.helpLevel} onChange={(v) => set("helpLevel", v)} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dificultad" error={fields.difficulty}>
                {(p) => (
                  <Select id={p.id} aria-describedby={p.describedBy} value={values.difficulty} onChange={(e) => set("difficulty", e.target.value as TutorValues["difficulty"])}>
                    {Object.entries(DIFFICULTIES).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Edad de los estudiantes" optional error={fields.studentAge}>
                {(p) => (
                  <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.studentAge} onChange={(e) => set("studentAge", e.target.value)} maxLength={LIMITS.studentAge} placeholder="Ej.: 10 a 11 años" />
                )}
              </Field>
            </div>

            <TextField label="Objetivos del tutor" k="objectives" values={values} set={set} error={fields.objectives} hint="Qué querés que logre el estudiante al conversar con este tutor." original={original?.objectives} />
            <TextField label="Tipo de preguntas" k="questionStyle" values={values} set={set} error={fields.questionStyle} original={original?.questionStyle} />
            <TextField label="Estrategias" k="strategies" values={values} set={set} error={fields.strategies} hint="Cómo ayuda a pensar: qué pide, qué compara, qué revisa." original={original?.strategies} />
            <TextField label="Criterios de cierre" k="closingCriteria" values={values} set={set} error={fields.closingCriteria} hint="Cuándo da por terminada la conversación." original={original?.closingCriteria} />
            <TextField
              label="Reglas del docente"
              k="rules"
              values={values}
              set={set}
              error={fields.rules}
              optional
              hint="Indicaciones propias: un personaje, un tema a evitar, ejemplos que prefieras. El tutor las sigue mientras no contradigan sus reglas generales (no dar la respuesta, cuidar a los alumnos)."
            />

            <section aria-labelledby="tutor-preview-title" className="rounded-lg border border-line bg-paper px-4 py-4">
              <h3 id="tutor-preview-title" className="font-display text-base font-semibold text-ink">
                Lo que recibe el tutor
              </h3>
              <p className="mt-0.5 text-[13px] leading-5 text-text-3">
                Se suma debajo de las reglas generales del tutor socrático. Las actividades guardan una copia: si después cambiás este tutor, las que ya lo usan no cambian.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TutorTypeTile type={values.tutorType} size="sm" />
                <Badge tone="ink">{TUTOR_TYPES[values.tutorType] ?? "Tipo"}</Badge>
                <Badge tone="neutral">{HELP_LEVELS[values.helpLevel]?.label}</Badge>
              </div>
              {TUTOR_TYPE_GUIDANCE[values.tutorType] ? (
                <p className="mt-3 text-sm leading-6 text-text-2">
                  <span className="font-semibold text-text">Cómo trabajar: </span>
                  {TUTOR_TYPE_GUIDANCE[values.tutorType]}
                </p>
              ) : null}
              <pre aria-live="polite" className="mt-3 max-h-72 overflow-y-auto rounded-md bg-surface px-3 py-2.5 font-sans text-sm leading-6 whitespace-pre-wrap text-text">
                {preview.text || "Sin indicaciones del docente: el tutor trabaja solo con su tipo y su nivel de ayuda."}
              </pre>
              <p className={preview.truncated ? "mt-2 text-[13px] font-semibold text-rose" : "mt-2 text-[13px] text-text-3"}>
                {preview.truncated
                  ? `Las indicaciones superan los ${MAX_TUTOR_RULES} caracteres: el final no llega al tutor. Acortá algún campo.`
                  : `${preview.text.length} de ${MAX_TUTOR_RULES} caracteres.`}
              </p>
            </section>

            <FormError message={saveError && !Object.keys(fields).length ? errorMessage(saveError) : null} />
            <button type="submit" hidden />
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm === "discard"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Descartar los cambios?"
        description={<p>Hay cambios sin guardar en este tutor. Si cerrás, se pierden.</p>}
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onConfirm={() => {
          setConfirm(null);
          setValues(initial);
          onOpenChange(false);
        }}
      />
      <ConfirmDialog
        open={confirm === "restore"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Restaurar el original?"
        description={<p>Vuelven los textos y el nivel de ayuda con los que viene «{original?.name}». Lo que cambiaste en este tutor se pierde. Las actividades que ya lo usan no cambian.</p>}
        confirmLabel="Restaurar original"
        variant="primary"
        loading={m.restore.isPending}
        onConfirm={() => {
          if (!tutorId) return;
          m.restore.mutate(tutorId, {
            onSuccess: (r) => {
              const v = fromDetail(r.tutor);
              setValues(v);
              setInitial(v);
              setConfirm(null);
              toast.success("Tutor restaurado");
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`¿Eliminar «${tutor?.name ?? ""}»?`}
        description={
          <p>
            Se borra de Mis tutores. {tutor?.usedInActivities ? `Las ${plural(tutor.usedInActivities, "actividad", "actividades")} que lo usan conservan la configuración que copiaron.` : "Ninguna actividad lo usa."}
          </p>
        }
        confirmLabel="Eliminar tutor"
        loading={m.remove.isPending}
        onConfirm={() => {
          if (!tutorId) return;
          m.remove.mutate(tutorId, {
            onSuccess: () => {
              setConfirm(null);
              setInitial(values);
              toast.success("Tutor eliminado");
              onOpenChange(false);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </>
  );

  function duplicate(id: string) {
    m.duplicate.mutate(id, {
      onSuccess: (r) => {
        toast.success(`Creaste «${r.tutor.name}»`);
        setInitial(values);
        onOpenChange(false);
        onCreated?.(r.tutor);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }
}

function TextField({
  label,
  k,
  values,
  set,
  error,
  hint,
  optional,
  original,
}: {
  label: string;
  k: "objectives" | "questionStyle" | "strategies" | "closingCriteria" | "rules";
  values: TutorValues;
  set: <K extends keyof TutorValues>(k: K, v: TutorValues[K]) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  original?: string;
}) {
  const max = LIMITS[k] ?? 2000;
  const changed = original !== undefined && values[k].trim() !== original.trim();
  return (
    <Field label={label} optional={optional} error={error} hint={hint} counter={{ value: values[k].length, max }}>
      {(p) => (
        <div className="grid gap-1.5">
          <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values[k]} onChange={(e) => set(k, e.target.value)} minRows={2} maxRows={8} />
          {changed ? (
            <button type="button" className="justify-self-start text-[13px] font-semibold text-lilac-ink underline decoration-lilac underline-offset-4" onClick={() => set(k, original)}>
              Volver al texto original de este campo
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

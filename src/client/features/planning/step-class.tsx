import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { Notice, Skeleton } from "@client/components/ui/misc";
import { errorMessage } from "@client/lib/api";
import { useClassrooms } from "@client/features/classrooms/api";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";
import { classroomLabel, type ClassroomSummary } from "@shared/contracts/classrooms";
import type { WizardState } from "./wizard-state";

const DURATIONS = [40, 60, 80, 120];

export function gradeOf(c: ClassroomSummary) {
  return [c.grade, c.division].filter(Boolean).join(" ");
}

export function StepClass({
  state: s,
  update,
  errors,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  errors: Record<string, string>;
}) {
  const rooms = useClassrooms(false);
  const [creating, setCreating] = useState(false);
  const missing = Boolean(s.classroomId && rooms.data && !rooms.data.some((r) => r.id === s.classroomId));

  const pick = (c: ClassroomSummary | undefined) => {
    if (!c) {
      update({ classroomId: "" });
      return;
    }
    update({ classroomId: c.id, subject: s.subject || c.subject, grade: s.grade || gradeOf(c) });
  };

  return (
    <div className="grid gap-5">
      <Field label="Aula" error={errors.classroomId} hint="La actividad se crea en esta aula. Podés crear una nueva acá mismo.">
        {(p) =>
          rooms.isPending ? (
            <Skeleton className="h-11 w-full" />
          ) : rooms.isError ? (
            <FormError message={errorMessage(rooms.error)} />
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Select
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={missing ? "" : s.classroomId}
                  onChange={(e) => pick(rooms.data.find((r) => r.id === e.target.value))}
                >
                  <option value="">{rooms.data.length ? "Elegí un aula" : "Todavía no tenés aulas"}</option>
                  {rooms.data.map((r) => (
                    <option key={r.id} value={r.id}>
                      {classroomLabel(r)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nueva aula
              </Button>
            </div>
          )
        }
      </Field>
      {missing ? (
        <Notice tone="amber">El aula que estaba elegida está archivada o ya no existe. Elegí otra para seguir.</Notice>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Materia" optional error={errors.subject}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={s.subject} onChange={(e) => update({ subject: e.target.value })} maxLength={80} placeholder="Ej.: Ciencias Naturales" />}
        </Field>
        <Field label="Grado o año" optional error={errors.grade}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={s.grade} onChange={(e) => update({ grade: e.target.value })} maxLength={60} placeholder="Ej.: 5.º grado" />}
        </Field>
      </div>

      <Field label="Tema de la clase" error={errors.topic} hint="Qué van a trabajar. La IA lo usa para buscar en el material.">
        {(p) => (
          <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={s.topic} onChange={(e) => update({ topic: e.target.value })} maxLength={200} placeholder="Ej.: El ciclo del agua" />
        )}
      </Field>

      <Field label="Duración en minutos" optional error={errors.duration} hint="Las propuestas se arman para que entren en ese tiempo.">
        {(p) => (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              inputMode="numeric"
              value={s.duration}
              onChange={(e) => update({ duration: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
              className="w-28"
              placeholder="80"
            />
            {DURATIONS.map((d) => (
              <Button key={d} size="sm" variant={s.duration === String(d) ? "primary" : "secondary"} aria-pressed={s.duration === String(d)} onClick={() => update({ duration: String(d) })}>
                {d} min
              </Button>
            ))}
          </div>
        )}
      </Field>

      <Field label="Conocimientos previos" optional error={errors.priorKnowledge} hint="Qué saben ya tus alumnos sobre el tema. Las propuestas parten de ahí." counter={{ value: s.priorKnowledge.length, max: 2000 }}>
        {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={s.priorKnowledge} onChange={(e) => update({ priorKnowledge: e.target.value })} minRows={2} />}
      </Field>

      <ClassroomFormDialog open={creating} onOpenChange={setCreating} onSaved={(c) => update({ classroomId: c.id, subject: s.subject || c.subject, grade: s.grade || gradeOf(c) })} />
    </div>
  );
}

/** activeIds: classrooms that can receive activities (archived ones are not listed). */
export function classErrors(s: WizardState, activeIds?: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.classroomId || (activeIds && !activeIds.includes(s.classroomId))) e.classroomId = "Elegí un aula o creá una nueva.";
  if (s.topic.trim().length < 2) e.topic = "Escribí el tema de la clase.";
  if (s.duration.trim()) {
    const n = Number(s.duration);
    if (!Number.isInteger(n) || n < 5 || n > 600) e.duration = "Poné una duración entre 5 y 600 minutos, o dejala vacía.";
  }
  if (s.priorKnowledge.length > 2000) e.priorKnowledge = "Usá hasta 2000 caracteres.";
  return e;
}

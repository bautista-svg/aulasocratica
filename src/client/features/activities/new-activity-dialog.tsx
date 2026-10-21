import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Dialog } from "@client/components/ui/dialog";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Input, Select } from "@client/components/ui/field";
import { api, ApiError, errorMessage } from "@client/lib/api";
import { useTutors } from "@client/features/tutors/api";
import { TUTOR_TYPES } from "@shared/domain/pedagogy";

/** Creates a draft activity in a classroom, optionally starting from a saved tutor. */
export function NewActivityDialog({ classroomId, open, onOpenChange }: { classroomId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [tutorId, setTutorId] = useState("");
  const tutors = useTutors();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post<{ activity: { id: string } }>("/api/activities", { classroomId, title, tutorId: tutorId || null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["classrooms"] });
      void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activity.id } });
    },
  });
  useEffect(() => {
    if (open) {
      setTitle("");
      setTutorId("");
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fields = create.error instanceof ApiError ? create.error.fields : {};

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nueva actividad"
      description="Empezá con un título. En el paso siguiente escribís la consigna y sumás el material."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>
            Crear y seguir
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Field label="Título" error={fields.title} hint="Lo ven tus alumnos al abrir el enlace.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />}
        </Field>
        <Field label="Tutor" hint="Podés cambiarlo y ajustarlo después.">
          {(p) => (
            <Select id={p.id} aria-describedby={p.describedBy} value={tutorId} onChange={(e) => setTutorId(e.target.value)} disabled={tutors.isPending}>
              <option value="">Pensamiento crítico (predeterminado)</option>
              {(tutors.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.presetKey ? "" : ` · ${TUTOR_TYPES[t.tutorType] ?? "Personalizado"}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <FormError message={create.isError && !fields.title ? errorMessage(create.error) : null} />
        <button type="submit" hidden />
      </form>
      <div className="mt-5 rounded-md bg-lilac-soft/60 px-4 py-3 text-sm text-text-2">
        ¿Tenés un PDF, un Word o una foto del tema?{" "}
        <Link
          to="/app/crear"
          search={{ aula: classroomId }}
          onClick={() => onOpenChange(false)}
          className={buttonClass("ghost", "sm", "-ml-1 inline-flex h-auto px-1 py-0 text-lilac-ink underline decoration-lilac underline-offset-4")}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Creala con IA a partir del material
        </Link>
      </div>
    </Dialog>
  );
}

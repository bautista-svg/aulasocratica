import { useEffect, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Dialog } from "@client/components/ui/dialog";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Input, Select } from "@client/components/ui/field";
import { api, ApiError, errorMessage } from "@client/lib/api";
import { useTutors } from "@client/features/tutors/api";
import { tutorOptionLabel } from "@client/features/tutors/tutor-visual";
import type { ActivityEditorData } from "@shared/contracts/activities";
import type { TutorSummary } from "@shared/contracts/tutors";
import { useRequestId, useSingleFlight } from "./single-flight";
import { storeActivity } from "./api";

/** The teacher's own "Pensamiento crítico" (edited or not): the default tutor of a new activity. */
export function defaultTutorId(tutors: TutorSummary[] | undefined): string {
  return tutors?.find((t) => t.presetKey === "pensamiento_critico")?.id ?? tutors?.find((t) => t.presetKey)?.id ?? "";
}

/** Creates a draft activity in a classroom, starting from a tutor of "Mis tutores". */
export function NewActivityDialog({ classroomId, open, onOpenChange }: { classroomId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState("");
  // "" until the tutors load; then the teacher's "Pensamiento crítico" unless they pick another one.
  const [tutorId, setTutorId] = useState("");
  const tutors = useTutors();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requestId = useRequestId(open);
  const create = useMutation({
    mutationFn: (body: { classroomId: string; title: string; tutorId: string | null; requestId: string }) =>
      api.post<{ activity: ActivityEditorData }>("/api/activities", body),
    onSuccess: (r) => {
      storeActivity(qc, r.activity);
      void qc.invalidateQueries({ queryKey: ["classrooms"] });
      void qc.invalidateQueries({ queryKey: ["tutors"] });
      onOpenChange(false);
      void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activity.id } });
    },
  });
  const start = useSingleFlight(create.isPending);
  useEffect(() => {
    if (open) {
      setTitle("");
      setTutorId(defaultTutorId(tutors.data));
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && !tutorId && tutors.data) setTutorId(defaultTutorId(tutors.data));
  }, [open, tutorId, tutors.data]);
  const fields = create.error instanceof ApiError ? create.error.fields : {};

  const submit = () => {
    // A double click (or Enter + click) creates one activity, never two.
    if (!title.trim() || !start()) return;
    create.mutate({ classroomId, title, tutorId: tutorId || null, requestId });
  };

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
          <Button loading={create.isPending} disabled={!title.trim() || tutors.isPending} onClick={submit}>
            Crear y seguir
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Título" error={fields.title} hint="Lo ven tus alumnos al abrir el enlace.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />}
        </Field>
        <Field label="Tutor" error={fields.tutorId} hint="Se copia su configuración de Mis tutores (con tus cambios). Podés ajustarla después.">
          {(p) => (
            <Select id={p.id} aria-describedby={p.describedBy} value={tutorId} onChange={(e) => setTutorId(e.target.value)} disabled={tutors.isPending}>
              {tutors.isPending ? <option value="">Cargando tus tutores…</option> : null}
              {tutors.isError ? <option value="">Pensamiento crítico</option> : null}
              {(tutors.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {tutorOptionLabel(t)}
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

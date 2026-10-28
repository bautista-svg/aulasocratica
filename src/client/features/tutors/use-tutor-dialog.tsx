import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog } from "@client/components/ui/dialog";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError, Input, Select } from "@client/components/ui/field";
import { Skeleton } from "@client/components/ui/misc";
import { api, ApiError, errorMessage } from "@client/lib/api";
import { useClassrooms } from "@client/features/classrooms/api";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { TutorSummary } from "@shared/contracts/tutors";
import { useRequestId, useSingleFlight } from "@client/features/activities/single-flight";

/** Creates a draft activity that starts from this tutor and opens it. */
export function UseTutorDialog({ tutor, open, onOpenChange }: { tutor: TutorSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const rooms = useClassrooms(false, "editable");
  const [classroomId, setClassroomId] = useState("");
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requestId = useRequestId(open);
  const create = useMutation({
    mutationFn: () => api.post<{ activity: { id: string } }>("/api/activities", { classroomId, title, tutorId: tutor!.id, requestId }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["classrooms"] });
      void qc.invalidateQueries({ queryKey: ["tutors"] });
      toast.success("Actividad creada");
      onOpenChange(false);
      void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activity.id } });
    },
  });

  useEffect(() => {
    if (open) {
      setTitle("");
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && !classroomId && rooms.data?.length === 1) setClassroomId(rooms.data[0]!.id);
  }, [open, rooms.data, classroomId]);

  const fields = create.error instanceof ApiError ? create.error.fields : {};
  const ready = Boolean(classroomId && title.trim());
  const start = useSingleFlight(create.isPending);
  const submit = () => {
    if (ready && tutor && start()) create.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Usar en una actividad nueva"
      description={tutor ? `La actividad empieza con la configuración de «${tutor.name}». Después la ajustás como quieras.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} disabled={!ready || !tutor} onClick={submit}>
            Crear actividad
          </Button>
        </>
      }
    >
      {rooms.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : rooms.isError ? (
        <FormError message={errorMessage(rooms.error)} />
      ) : rooms.data.length === 0 ? (
        <div className="rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
          Para crear una actividad primero necesitás un aula.{" "}
          <Link to="/app/aulas" className={buttonClass("ghost", "sm", "h-auto px-1 py-0 text-lilac-ink underline underline-offset-4")} onClick={() => onOpenChange(false)}>
            Crear un aula
          </Link>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Aula" error={fields.classroomId}>
            {(p) => (
              <Select id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={classroomId} onChange={(e) => setClassroomId(e.target.value)}>
                <option value="">Elegí un aula</option>
                {rooms.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {classroomLabel(r)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Título de la actividad" error={fields.title} hint="Lo ven tus alumnos al abrir el enlace.">
            {(p) => (
              <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
            )}
          </Field>
          <FormError message={create.isError && !Object.keys(fields).length ? errorMessage(create.error) : null} />
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

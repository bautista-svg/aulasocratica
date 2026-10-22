import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Textarea } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import type { ClassroomSummary } from "@shared/contracts/classrooms";
import { useSaveClassroom } from "./api";
import { useRequestId, useSingleFlight } from "@client/features/activities/single-flight";

type Values = { name: string; school: string; teacherName: string; subject: string; grade: string; division: string; description: string };
const EMPTY: Values = { name: "", school: "", teacherName: "", subject: "", grade: "", division: "", description: "" };

export function ClassroomFormDialog({
  open,
  onOpenChange,
  classroom,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  classroom?: ClassroomSummary;
  onSaved?: (c: ClassroomSummary) => void;
}) {
  const [values, setValues] = useState<Values>(EMPTY);
  const save = useSaveClassroom();
  const start = useSingleFlight(save.isPending);
  const requestId = useRequestId(open);
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  useEffect(() => {
    if (open) {
      setValues(
        classroom
          ? {
              name: classroom.name,
              school: classroom.school,
              teacherName: classroom.teacherName,
              subject: classroom.subject,
              grade: classroom.grade,
              division: classroom.division,
              description: classroom.description,
            }
          : EMPTY,
      );
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, classroom?.id]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = () => {
    // Enter + click, or a double click, must not create two classrooms.
    if (!values.name.trim() || !start()) return;
    save.mutate(
      { id: classroom?.id, data: classroom ? values : { ...values, requestId } },
      {
        onSuccess: (r) => {
          toast.success(classroom ? "Cambios guardados" : "Aula creada");
          onOpenChange(false);
          onSaved?.(r.classroom);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={classroom ? "Editar aula" : "Nueva aula"}
      description={classroom ? undefined : "Un aula agrupa las actividades y los alumnos de un curso."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!values.name.trim()}>
            {classroom ? "Guardar cambios" : "Crear aula"}
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
        <Field label="Nombre del aula" error={fields.name} hint="Por ejemplo: 5.º B — Ciencias Naturales">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={values.name} onChange={set("name")} maxLength={120} autoFocus required />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Docente" optional error={fields.teacherName}>
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p.describedBy}
                value={values.teacherName}
                onChange={set("teacherName")}
                maxLength={80}
                autoComplete="name"
                placeholder="Laura Gómez"
              />
            )}
          </Field>
          <Field label="Escuela" optional error={fields.school}>
            {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={values.school} onChange={set("school")} maxLength={160} />}
          </Field>
          <Field label="Grado o año" optional error={fields.grade}>
            {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={values.grade} onChange={set("grade")} maxLength={40} placeholder="5.º grado" />}
          </Field>
          <Field label="División" optional error={fields.division}>
            {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={values.division} onChange={set("division")} maxLength={40} placeholder="B" />}
          </Field>
        </div>
        <Field label="Notas" optional error={fields.description} counter={{ value: values.description.length, max: 2000 }}>
          {(p) => <Textarea id={p.id} aria-describedby={p.describedBy} value={values.description} onChange={set("description")} minRows={2} />}
        </Field>
        <FormError message={save.isError && !Object.keys(fields).length ? errorMessage(save.error) : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

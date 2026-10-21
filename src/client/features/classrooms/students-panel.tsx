import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { Badge, EmptyState, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { fmtRelative, plural } from "@client/lib/format";
import { parseNameList } from "@shared/domain/names";
import type { ClassroomStudent } from "@shared/contracts/classrooms";
import { useClassroomActivities, useClassroomStudents, useStudentMutations } from "./api";
import { workStatusLabel } from "@client/features/live/bits";
import { useSingleFlight } from "@client/features/activities/single-flight";

export function StudentsPanel({
  classroomId,
  activityFilter,
  onFilterChange,
}: {
  classroomId: string;
  activityFilter?: string;
  onFilterChange: (activityId: string) => void;
}) {
  const students = useClassroomStudents(classroomId);
  const activities = useClassroomActivities(classroomId);
  const m = useStudentMutations(classroomId);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ClassroomStudent | null>(null);
  const [removing, setRemoving] = useState<ClassroomStudent | null>(null);

  const filtered = useMemo(() => {
    const list = students.data ?? [];
    if (!activityFilter) return list;
    return list.filter((s) => s.sessions.some((x) => x.activityId === activityFilter));
  }, [students.data, activityFilter]);

  if (students.isPending) return <SkeletonList rows={3} />;
  if (students.isError) return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;

  const filterActivity = activities.data?.find((a) => a.id === activityFilter);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="student-filter" className="mb-1.5 block text-sm font-semibold text-text">
            Mostrar alumnos de
          </label>
          <Select id="student-filter" value={activityFilter ?? ""} onChange={(e) => onFilterChange(e.target.value)}>
            <option value="">Todas las actividades</option>
            {(activities.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
          Agregar alumnos
        </Button>
      </div>

      {students.data.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="Todavía no hay alumnos en esta aula"
          description="Los alumnos aparecen solos cuando entran a una actividad con su nombre. También podés cargar la lista antes."
          action={
            <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              Cargar lista de alumnos
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nadie hizo esta actividad todavía" description={`Cuando un alumno entre a «${filterActivity?.title ?? "la actividad"}», va a aparecer acá.`} />
      ) : (
        <>
          <p className="mb-2 text-sm text-text-3">
            {activityFilter ? `${plural(filtered.length, "alumno hizo", "alumnos hicieron")} esta actividad` : plural(filtered.length, "alumno", "alumnos")}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
            {filtered.map((s) => {
              const sessions = activityFilter ? s.sessions.filter((x) => x.activityId === activityFilter) : s.sessions;
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <Link to="/app/alumnos/$studentId" params={{ studentId: s.id }} className="font-semibold text-ink hover:underline hover:decoration-lilac hover:underline-offset-4">
                      {s.fullName}
                    </Link>
                    {sessions.length === 0 ? (
                      <p className="mt-0.5 text-sm text-text-3">{s.selfRegistered ? "Sin actividades" : "Cargado en la lista · todavía no hizo actividades"}</p>
                    ) : (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {sessions.map((x) => (
                          <li key={x.sessionId}>
                            <Link to="/app/sesiones/$sessionId" params={{ sessionId: x.sessionId }} className="inline-flex py-1">
                              <Badge tone={x.status === "completed" ? "leaf" : "ink"} className="hover:underline">
                                {activityFilter ? workStatusLabel(x.status, x.lastActivityAt) : x.activityTitle}
                                {/* Same colour as the rest of the badge: a lighter text fails contrast (D14). */}
                                <span className="font-normal">· {fmtRelative(x.lastActivityAt)}</span>
                              </Badge>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Menu
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Opciones de ${s.fullName}`}>
                        <MoreHorizontal className="size-5" />
                      </Button>
                    }
                    items={[
                      { label: "Corregir nombre", icon: <Pencil className="size-4" />, onSelect: () => setRenaming(s) },
                      { label: "Eliminar alumno y sus trabajos", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setRemoving(s) },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}

      <AddStudentsDialog open={adding} onOpenChange={setAdding} classroomId={classroomId} />
      <RenameDialog student={renaming} onClose={() => setRenaming(null)} classroomId={classroomId} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`¿Eliminar a ${removing?.fullName ?? ""}?`}
        description={
          <p>
            Se borran sus trabajos en {plural(removing?.sessions.length ?? 0, "actividad", "actividades")} de esta aula: respuestas, conversaciones con el tutor y
            evaluaciones. No se puede deshacer.
          </p>
        }
        confirmLabel="Eliminar alumno"
        loading={m.remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          m.remove.mutate(removing.id, {
            onSuccess: () => {
              toast.success("Alumno eliminado");
              setRemoving(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
    </div>
  );
}

function AddStudentsDialog({ open, onOpenChange, classroomId }: { open: boolean; onOpenChange: (o: boolean) => void; classroomId: string }) {
  const [text, setText] = useState("");
  const { add } = useStudentMutations(classroomId);
  const start = useSingleFlight(add.isPending);
  const names = parseNameList(text);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setText("");
        onOpenChange(o);
      }}
      title="Agregar alumnos"
      description="Pegá la lista del curso: un nombre por renglón. Cuando un alumno entre a una actividad con el mismo nombre, sus trabajos quedan a su nombre."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={names.length === 0}
            loading={add.isPending}
            onClick={() => {
              if (!start()) return;
              add.mutate(names, {
                onSuccess: (r) => {
                  const added =
                    r.added === 0 ? "No se agregaron alumnos nuevos." : r.added === 1 ? "Se agregó 1 alumno." : `Se agregaron ${plural(r.added, "alumno", "alumnos")}.`;
                  const skipped = r.skipped ? ` ${r.skipped === 1 ? "1 ya estaba en la lista" : `${r.skipped} ya estaban en la lista`}.` : "";
                  toast.success(`${added}${skipped}`);
                  setText("");
                  onOpenChange(false);
                },
              });
            }}
          >
            {names.length ? `Agregar ${plural(names.length, "alumno", "alumnos")}` : "Agregar"}
          </Button>
        </>
      }
    >
      <Field label="Nombres y apellidos">
        {(p) => <Textarea id={p.id} value={text} onChange={(e) => setText(e.target.value)} minRows={6} placeholder={"Ana Gómez\nBruno Pérez\nCamila Ruiz"} />}
      </Field>
      <div className="mt-3">
        <FormError message={add.isError ? errorMessage(add.error) : null} />
      </div>
    </Dialog>
  );
}

function RenameDialog({ student, onClose, classroomId }: { student: ClassroomStudent | null; onClose: () => void; classroomId: string }) {
  const [name, setName] = useState("");
  const { rename } = useStudentMutations(classroomId);
  const [lastId, setLastId] = useState<string | null>(null);
  if (student && student.id !== lastId) {
    setLastId(student.id);
    setName(student.fullName);
    rename.reset();
  }
  return (
    <Dialog
      open={Boolean(student)}
      onOpenChange={(o) => !o && onClose()}
      title="Corregir nombre"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={rename.isPending}
            disabled={name.trim().length < 2}
            onClick={() =>
              student &&
              rename.mutate(
                { id: student.id, fullName: name },
                {
                  onSuccess: () => {
                    toast.success("Nombre corregido");
                    onClose();
                  },
                },
              )
            }
          >
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Nombre y apellido" error={rename.isError ? errorMessage(rename.error) : undefined}>
        {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
      </Field>
    </Dialog>
  );
}

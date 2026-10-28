import { memo, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, MoreHorizontal, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import { Badge, EmptyState, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, FormError, Input, Select, Textarea } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtRelative, plural } from "@client/lib/format";
import { parseNameList } from "@shared/domain/names";
import { divisionCounts, inDivision } from "@shared/domain/divisions";
import type { ClassroomStudent } from "@shared/contracts/classrooms";
import { useClassroom, useClassroomActivities, useClassroomStudents, useStudentMutations } from "./api";
import { DivisionTag } from "./divisions";
import { workStatusLabel } from "@client/features/live/bits";
import { useSingleFlight } from "@client/features/activities/single-flight";
import { useCan } from "@client/features/sharing/role";

// Memoized: the classroom tabs re-render on every tab change; this panel only depends on its props.
export const StudentsPanel = memo(function StudentsPanel({
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
  const room = useClassroom(classroomId);
  const m = useStudentMutations(classroomId);
  // In a shared classroom only the owner and admins change the list.
  const canManage = useCan("manage");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<ClassroomStudent | null>(null);
  const [removing, setRemoving] = useState<ClassroomStudent | null>(null);
  const [divisionPick, setDivision] = useState<string | null>(null);

  const divisionOptions = room.data?.divisionOptions ?? [];
  const divisions = useMemo(() => divisionCounts(divisionOptions, (students.data ?? []).map((s) => s.division)), [divisionOptions, students.data]);
  // A division nobody has anymore (and the classroom no longer lists) goes back to «Todas».
  const division = divisionPick !== null && divisions.some((d) => d.value === divisionPick) ? divisionPick : null;

  const filtered = useMemo(() => {
    let list = students.data ?? [];
    if (activityFilter) list = list.filter((s) => s.sessions.some((x) => x.activityId === activityFilter));
    if (division !== null) list = list.filter((s) => inDivision(s.division, division));
    return list;
  }, [students.data, activityFilter, division]);

  if (students.isPending) return <SkeletonList rows={3} />;
  if (students.isError) return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;

  const filterActivity = activities.data?.find((a) => a.id === activityFilter);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
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
          {divisions.length ? (
            <div className="w-full sm:max-w-[12rem]">
              <label htmlFor="student-division-filter" className="mb-1.5 block text-sm font-semibold text-text">
                División
              </label>
              <Select
                id="student-division-filter"
                value={division === null ? "*" : division}
                onChange={(e) => setDivision(e.target.value === "*" ? null : e.target.value)}
              >
                <option value="*">Todas ({students.data.length})</option>
                {divisions.map((d) => (
                  <option key={d.value || "none"} value={d.value}>
                    {d.value || "Sin división"} ({d.count})
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
        {canManage ? (
          <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Agregar alumnos
          </Button>
        ) : null}
      </div>

      {students.data.length === 0 ? (
        <EmptyState
          level={2}
          icon={<Users className="size-8" />}
          title="Todavía no hay alumnos en esta aula"
          description="Los alumnos aparecen solos cuando entran a una actividad con su nombre. También podés cargar la lista antes."
          action={
            canManage ? (
              <Button variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
                Cargar lista de alumnos
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        division !== null && !activityFilter ? (
          <EmptyState level={2} title="Nadie en esta división" description="Elegí otra división o «Todas»." />
        ) : (
          <EmptyState
            level={2}
            title={division !== null ? "Nadie de esta división hizo esta actividad" : "Nadie hizo esta actividad todavía"}
            description={`Cuando un alumno entre a «${filterActivity?.title ?? "la actividad"}», va a aparecer acá.`}
          />
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-text-3">
            {activityFilter ? `${plural(filtered.length, "alumno hizo", "alumnos hicieron")} esta actividad` : plural(filtered.length, "alumno", "alumnos")}
            {division !== null ? ` · ${division ? `división ${division}` : "sin división"}` : ""}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
            {filtered.map((s) => {
              const sessions = activityFilter ? s.sessions.filter((x) => x.activityId === activityFilter) : s.sessions;
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link to="/app/alumnos/$studentId" params={{ studentId: s.id }} className="font-semibold text-ink hover:underline hover:decoration-lilac hover:underline-offset-4">
                        {s.fullName}
                      </Link>
                      <DivisionTag division={s.division} />
                    </div>
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
                  {canManage ? (
                    <Menu
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Opciones de ${s.fullName}`}>
                          <MoreHorizontal className="size-5" />
                        </Button>
                      }
                      items={[
                        {
                          label: divisionOptions.length || s.division ? "Corregir nombre o división" : "Corregir nombre",
                          icon: <Pencil className="size-4" />,
                          onSelect: () => setRenaming(s),
                        },
                        { label: "Eliminar alumno y sus trabajos", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setRemoving(s) },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <AddStudentsDialog open={adding} onOpenChange={setAdding} classroomId={classroomId} />
      <RenameDialog student={renaming} onClose={() => setRenaming(null)} classroomId={classroomId} divisionOptions={divisionOptions} />
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
});

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

function RenameDialog({
  student,
  onClose,
  classroomId,
  divisionOptions,
}: {
  student: ClassroomStudent | null;
  onClose: () => void;
  classroomId: string;
  divisionOptions: string[];
}) {
  const [name, setName] = useState("");
  const [division, setDivision] = useState("");
  const { rename } = useStudentMutations(classroomId);
  const [lastId, setLastId] = useState<string | null>(null);
  if (student && student.id !== lastId) {
    setLastId(student.id);
    setName(student.fullName);
    setDivision(student.division);
    rename.reset();
  }
  // The classroom's divisions, plus the one the student has if the teacher removed it from the list.
  const choices = student?.division && !divisionOptions.some((d) => inDivision(d, student.division)) ? [...divisionOptions, student.division] : divisionOptions;
  const fields = rename.error instanceof ApiError ? rename.error.fields : {};
  return (
    <Dialog
      open={Boolean(student)}
      onOpenChange={(o) => !o && onClose()}
      title={choices.length ? "Corregir nombre o división" : "Corregir nombre"}
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
                { id: student.id, fullName: name, ...(choices.length ? { division } : {}) },
                {
                  onSuccess: () => {
                    toast.success(division !== student.division && name.trim() === student.fullName ? "División corregida" : "Datos corregidos");
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
      <div className="grid gap-4">
        <Field label="Nombre y apellido" error={fields.fullName ?? (rename.isError && !fields.division ? errorMessage(rename.error) : undefined)}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
        </Field>
        {choices.length ? (
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-text">División</legend>
            <div className="flex flex-wrap gap-2">
              {[...choices, ""].map((d) => {
                const on = division === d;
                return (
                  <label
                    key={d || "none"}
                    className={cn(
                      "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-lilac/35",
                      on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40 hover:text-ink",
                      !d && !on && "font-medium",
                    )}
                  >
                    <input type="radio" name="student-division" value={d} checked={on} onChange={() => setDivision(d)} className="sr-only" />
                    {on ? <Check className="size-4" aria-hidden="true" /> : null}
                    {d || "Sin división"}
                  </label>
                );
              })}
            </div>
            {fields.division ? <p className="mt-1.5 text-[13px] font-medium leading-5 text-rose">{fields.division}</p> : null}
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  );
}

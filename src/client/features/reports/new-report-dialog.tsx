import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Dialog } from "@client/components/ui/dialog";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Select } from "@client/components/ui/field";
import { Notice } from "@client/components/ui/misc";
import { cn } from "@client/lib/cn";
import { ApiError, errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { useClassroomActivities, useClassroomStudents, useClassrooms } from "@client/features/classrooms/api";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { CreateReportInput } from "@shared/contracts/reports";
import { REPORT_KIND_DESCRIPTIONS, REPORT_KIND_LABELS, REPORT_KINDS, type ReportKind } from "@shared/domain/reports";
import { focusFirstInvalid } from "@client/lib/forms";
import { useCreateReport } from "./api";

export function NewReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [kind, setKind] = useState<ReportKind>("group");
  const [classroomId, setClassroomId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [title, setTitle] = useState("");
  // Missing choices are explained under each field when "Crear informe" is pressed.
  const [missing, setMissing] = useState<{ classroom?: string; student?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);
  const create = useCreateReport();
  const navigate = useNavigate();
  const rooms = useClassrooms(false);
  const kindName = useId();

  useEffect(() => {
    if (open) {
      setKind("group");
      setClassroomId("");
      setStudentId("");
      setSessionId("");
      setActivityId("");
      setTitle("");
      setMissing({});
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Single classroom: preselect it.
  useEffect(() => {
    if (open && !classroomId && rooms.data?.length === 1) setClassroomId(rooms.data[0]!.id);
  }, [open, classroomId, rooms.data]);

  const fields = create.error instanceof ApiError ? create.error.fields : {};
  const noRooms = rooms.isSuccess && rooms.data.length === 0;

  const body = (): CreateReportInput | null => {
    const t = title.trim() ? { title: title.trim() } : {};
    if (kind === "overview") return { kind, ...t };
    if (!classroomId) return null;
    if (kind === "group") return { kind, scope: activityId ? { activityId } : { classroomId }, ...t };
    if (!studentId) return null;
    return { kind, scope: sessionId ? { sessionId } : { studentId }, ...t };
  };
  const submit = () => {
    if (noRooms) return;
    const b = body();
    if (!b) {
      setMissing(!classroomId ? { classroom: "Elegí un aula." } : { student: "Elegí un alumno." });
      focusFirstInvalid(formRef.current);
      return;
    }
    create.mutate(b, {
      onSuccess: (r) => {
        toast.success("Informe creado");
        onOpenChange(false);
        void navigate({ to: "/app/informes/$reportId", params: { reportId: r.report.id } });
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Nuevo informe"
      description="El informe se arma con los datos registrados hasta ahora. Más adelante podés actualizarlos."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} disabled={noRooms} onClick={submit}>
            Crear informe
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-text">Tipo de informe</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {REPORT_KINDS.map((k) => (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer flex-col rounded-md border px-3.5 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lilac-ink",
                  kind === k ? "border-ink bg-ink-soft/60" : "border-line-strong bg-surface hover:border-ink/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={kindName}
                    value={k}
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setMissing({});
                    }}
                    className="size-4 accent-[var(--color-ink)]"
                  />
                  <span className="font-semibold text-text">{REPORT_KIND_LABELS[k]}</span>
                </span>
                <span className="mt-1 text-[13px] leading-5 text-text-2">{REPORT_KIND_DESCRIPTIONS[k]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {noRooms ? (
          <Notice tone="amber">Todavía no tenés aulas activas. Creá un aula y una actividad para tener datos que informar.</Notice>
        ) : kind === "overview" ? (
          <p className="rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
            {rooms.data
              ? `Incluye tus ${plural(rooms.data.length, "aula activa", "aulas activas")}. Las archivadas no se cuentan.`
              : "Incluye todas tus aulas activas. Las archivadas no se cuentan."}
          </p>
        ) : (
          <>
            <Field label="Aula" error={missing.classroom ?? fields["scope.classroomId"]}>
              {(p) => (
                <Select
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={classroomId}
                  disabled={rooms.isPending}
                  onChange={(e) => {
                    setClassroomId(e.target.value);
                    setMissing({});
                    setStudentId("");
                    setSessionId("");
                    setActivityId("");
                  }}
                >
                  <option value="">{rooms.isPending ? "Cargando aulas…" : "Elegí un aula"}</option>
                  {(rooms.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {classroomLabel(r)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {rooms.isError ? <FormError message={errorMessage(rooms.error)} /> : null}
            {classroomId && kind === "individual" ? (
              <StudentPickers
                classroomId={classroomId}
                studentId={studentId}
                sessionId={sessionId}
                onStudent={(id) => {
                  setStudentId(id);
                  setSessionId("");
                  setMissing({});
                }}
                onSession={setSessionId}
                error={missing.student ?? fields["scope.studentId"]}
              />
            ) : null}
            {classroomId && kind === "group" ? <ActivityPicker classroomId={classroomId} value={activityId} onChange={setActivityId} /> : null}
          </>
        )}

        <Field label="Título" optional error={fields.title} hint="Si lo dejás vacío, se arma solo (por ejemplo «Informe grupal — 5.º B»).">
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          )}
        </Field>
        <FormError message={create.isError && Object.keys(fields).length === 0 ? errorMessage(create.error) : null} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function StudentPickers({
  classroomId,
  studentId,
  sessionId,
  onStudent,
  onSession,
  error,
}: {
  classroomId: string;
  studentId: string;
  sessionId: string;
  onStudent: (id: string) => void;
  onSession: (id: string) => void;
  error?: string;
}) {
  const students = useClassroomStudents(classroomId);
  const selected = students.data?.find((s) => s.id === studentId);
  if (students.isError) return <FormError message={errorMessage(students.error)} />;
  const withWork = (students.data ?? []).filter((s) => s.sessions.length > 0);
  return (
    <>
      <Field
        label="Alumno"
        error={error}
        hint={students.isSuccess && withWork.length === 0 ? "Ningún alumno de esta aula hizo actividades todavía." : undefined}
      >
        {(p) => (
          <Select
            id={p.id}
            aria-describedby={p.describedBy}
            invalid={p.invalid}
            value={studentId}
            disabled={students.isPending}
            onChange={(e) => onStudent(e.target.value)}
          >
            <option value="">{students.isPending ? "Cargando alumnos…" : "Elegí un alumno"}</option>
            {(students.data ?? []).map((s) => (
              <option key={s.id} value={s.id} disabled={s.sessions.length === 0}>
                {s.fullName}
                {s.sessions.length === 0 ? " (sin actividades)" : ` (${plural(s.sessions.length, "actividad", "actividades")})`}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {selected && selected.sessions.length > 1 ? (
        <Field label="Actividades">
          {(p) => (
            <Select id={p.id} aria-describedby={p.describedBy} value={sessionId} onChange={(e) => onSession(e.target.value)}>
              <option value="">Todas sus actividades en esta aula</option>
              {selected.sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  Solo «{s.activityTitle}»
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
    </>
  );
}

function ActivityPicker({ classroomId, value, onChange }: { classroomId: string; value: string; onChange: (id: string) => void }) {
  const acts = useClassroomActivities(classroomId);
  if (acts.isError) return <FormError message={errorMessage(acts.error)} />;
  const list = (acts.data ?? []).filter((a) => a.status !== "draft" || a.participants > 0);
  return (
    <Field
      label="Actividades"
      hint={acts.isSuccess && list.length === 0 ? "Esta aula todavía no tiene actividades publicadas: el informe va a salir sin datos." : undefined}
    >
      {(p) => (
        <Select id={p.id} aria-describedby={p.describedBy} value={value} disabled={acts.isPending} onChange={(e) => onChange(e.target.value)}>
          <option value="">{acts.isPending ? "Cargando actividades…" : "Todas las actividades del aula"}</option>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              Solo «{a.title}» ({plural(a.participants, "participante", "participantes")})
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

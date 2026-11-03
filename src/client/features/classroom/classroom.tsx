// Google Classroom in the app: connect the account, publish an activity as a material («Consigna») or
// an assignment («Tarea»), send the
// grades back (from the rubric, editable) and bring a course's students into a classroom.
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, ExternalLink, FileText, GraduationCap, Link2Off, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonClass } from "@client/components/ui/button";
import { Dialog } from "@client/components/ui/dialog";
import { Input, Select } from "@client/components/ui/field";
import { Badge, Notice, Skeleton } from "@client/components/ui/misc";
import { Checkbox } from "@client/components/ui/controls";
import { errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { fmtRelative, plural } from "@client/lib/format";
import { DEFAULT_MAX_POINTS, MAX_POINTS_RANGE } from "@shared/domain/classroom";
import type { ActivityEditorData } from "@shared/contracts/activities";
import type { ClassroomKind } from "@shared/contracts/classroom";
import {
  connectUrl,
  useClassroomCourses,
  useClassroomGrades,
  useClassroomLink,
  useClassroomStatus,
  useDisconnectClassroom,
  useImportRoster,
  usePublishToClassroom,
  useSendGrades,
  useUnlinkClassroom,
} from "./api";

/** The green tile that marks everything Classroom. */
function ClassroomMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-leaf", className)} aria-hidden="true">
      <GraduationCap className="size-5" />
    </span>
  );
}

const here = () => `${window.location.pathname}${window.location.search}`;

/** Step 2 «Compartir»: publish the activity in a Classroom course and send its grades there. */
export function ClassroomShareCard({ activity, canEdit }: { activity: ActivityEditorData; canEdit: boolean }) {
  const status = useClassroomStatus();
  const connected = Boolean(status.data?.connected);
  const link = useClassroomLink(activity.id, connected);
  const [grading, setGrading] = useState(false);
  const unlink = useUnlinkClassroom(activity.id);
  if (!status.data?.available) return null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-1" aria-labelledby="classroom-title" data-tour="classroom">
      <div className="flex items-start gap-3">
        <ClassroomMark />
        <div className="min-w-0 flex-1">
          <h3 id="classroom-title" className="text-[16px] font-semibold tracking-[-0.02em] text-ink">
            Google Classroom
          </h3>
          {!connected ? (
            <>
              <p className="mt-1 text-[14px] leading-6 text-text-2">
                Subí esta actividad a un curso de Classroom como consigna o como tarea, con el enlace para tus alumnos. Si es tarea, después pasás las notas sin copiarlas a mano.
              </p>
              <a href={connectUrl(here())} className={buttonClass("secondary", "md", "mt-3")}>
                Conectar Google Classroom
              </a>
            </>
          ) : link.isPending ? (
            <Skeleton className="mt-2 h-5 w-2/3" />
          ) : link.data?.link ? (
            <>
              <p className="mt-1 text-[14px] leading-6 text-text-2">
                {link.data.link.kind === "material" ? (
                  <>
                    Está como consigna en <span className="font-medium text-ink">{link.data.link.courseName}</span>, sin nota.
                  </>
                ) : (
                  <>
                    Está como tarea en <span className="font-medium text-ink">{link.data.link.courseName}</span>, sobre {link.data.link.maxPoints} puntos.
                  </>
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {canEdit && link.data.link.kind === "assignment" ? (
                  <Button icon={<Send className="size-4" />} onClick={() => setGrading(true)}>
                    Pasar notas a Classroom
                  </Button>
                ) : null}
                <a href={link.data.link.url} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Abrir en Classroom
                </a>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    icon={<Link2Off className="size-4" />}
                    loading={unlink.isPending}
                    onClick={() =>
                      unlink.mutate(undefined, {
                        onSuccess: () => toast.success(`Desvinculada: la ${link.data?.link?.kind === "material" ? "consigna" : "tarea"} sigue en Classroom`),
                        onError: (e) => toast.error(errorMessage(e)),
                      })
                    }
                  >
                    Desvincular
                  </Button>
                ) : null}
              </div>
              {grading ? <GradesDialog activityId={activity.id} open onOpenChange={setGrading} /> : null}
            </>
          ) : activity.status !== "published" ? (
            <p className="mt-1 text-[14px] leading-6 text-text-2">Publicá la actividad y después la subís a Classroom con su enlace.</p>
          ) : canEdit ? (
            <PublishForm activityId={activity.id} />
          ) : (
            <p className="mt-1 text-[14px] leading-6 text-text-2">Todavía no está en Classroom.</p>
          )}
          {connected ? (
            <p className="mt-3 text-[12.5px] text-text-3">
              Conectado como {status.data.email}.{" "}
              {status.data.missingScopes ? (
                <a href={connectUrl(here())} className="font-medium text-rose underline underline-offset-4">
                  Faltan permisos: volvé a conectar
                </a>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const KIND_OPTIONS: { kind: ClassroomKind; title: string; hint: string; icon: typeof ClipboardList }[] = [
  { kind: "material", title: "Consigna", hint: "La consigna y el enlace, sin entrega ni nota.", icon: FileText },
  { kind: "assignment", title: "Tarea", hint: "Con puntos y entrega; después pasás las notas.", icon: ClipboardList },
];

/** «Consigna» or «Tarea»: two cards that work as one radio group. */
function KindChoice({ value, onChange }: { value: ClassroomKind; onChange: (k: ClassroomKind) => void }) {
  return (
    <fieldset className="col-span-full">
      <legend className="mb-1.5 text-[13px] font-medium text-text-2">Cómo aparece en Classroom</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {KIND_OPTIONS.map((o) => {
          const on = value === o.kind;
          const Icon = o.icon;
          return (
            <label
              key={o.kind}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lilac",
                on ? "border-lilac-ink bg-lilac-soft" : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <input type="radio" name="classroom-kind" value={o.kind} checked={on} onChange={() => onChange(o.kind)} className="sr-only" />
              <span
                className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full", on ? "bg-lilac-ink text-surface" : "bg-paper text-text-2")}
                aria-hidden="true"
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink">{o.title}</span>
                <span className="block text-[12.5px] leading-5 text-text-2">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function PublishForm({ activityId }: { activityId: string }) {
  const courses = useClassroomCourses(true);
  const publish = usePublishToClassroom(activityId);
  const [kind, setKind] = useState<ClassroomKind>("material");
  const [courseId, setCourseId] = useState("");
  const [points, setPoints] = useState(String(DEFAULT_MAX_POINTS));
  const [due, setDue] = useState("");
  const list = courses.data?.courses ?? [];
  useEffect(() => {
    if (!courseId && list.length === 1) setCourseId(list[0]!.id);
  }, [list, courseId]);
  const graded = kind === "assignment";
  const n = Number(points);
  const pointsOk = !graded || (Number.isInteger(n) && n >= MAX_POINTS_RANGE.min && n <= MAX_POINTS_RANGE.max);

  if (courses.isPending) return <Skeleton className="mt-3 h-11 w-full" />;
  if (courses.isError) return <p className="mt-2 text-[14px] text-rose" role="alert">{errorMessage(courses.error)}</p>;
  if (!list.length) return <p className="mt-1 text-[14px] leading-6 text-text-2">No encontramos cursos activos donde seas docente en Classroom.</p>;

  return (
    <form
      className={cn("mt-3 grid gap-3", graded && "sm:grid-cols-[minmax(0,1fr)_110px_160px]")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!courseId || !pointsOk) return;
        publish.mutate(graded ? { kind, courseId, maxPoints: n, dueDate: due || null } : { kind, courseId }, {
          onSuccess: () => toast.success(graded ? "Tarea creada en Classroom" : "Consigna publicada en Classroom"),
          onError: (err) => toast.error(errorMessage(err)),
        });
      }}
    >
      <KindChoice value={kind} onChange={setKind} />
      <label className={cn("grid gap-1.5 text-[13px] font-medium text-text-2", !graded && "sm:max-w-md")}>
        Curso
        <Select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
          <option value="">Elegí un curso</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.section ? `${c.name} · ${c.section}` : c.name}
            </option>
          ))}
        </Select>
      </label>
      {graded ? (
        <>
          <label className="grid gap-1.5 text-[13px] font-medium text-text-2">
            Puntos
            <Input type="number" inputMode="numeric" min={MAX_POINTS_RANGE.min} max={MAX_POINTS_RANGE.max} value={points} onChange={(e) => setPoints(e.target.value)} invalid={!pointsOk} />
          </label>
          <label className="grid gap-1.5 text-[13px] font-medium text-text-2">
            Entrega <span className="sr-only">(opcional)</span>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </>
      ) : null}
      <div className="col-span-full">
        <Button type="submit" disabled={!courseId || !pointsOk} loading={publish.isPending} icon={<GraduationCap className="size-4" />}>
          Subir a Classroom
        </Button>
        <p className="mt-2 text-[12.5px] text-text-3">
          {graded
            ? "Se crea como tarea publicada, con la consigna y el enlace. La fecha de entrega es opcional."
            : "Aparece en Trabajo de clase como material, con la consigna y el enlace. No lleva nota."}
        </p>
      </div>
    </form>
  );
}

/** Each work with its grade (from the rubric, editable) and the Classroom student it goes to. */
function GradesDialog({ activityId, open, onOpenChange }: { activityId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useClassroomGrades(activityId, open);
  const send = useSendGrades(activityId);
  const [edits, setEdits] = useState<Record<string, { grade?: string; userId?: string; on?: boolean }>>({});
  const [giveBack, setGiveBack] = useState(true);
  const [failed, setFailed] = useState<Record<string, string>>({});

  const rows = useMemo(
    () =>
      (q.data?.rows ?? []).map((r) => {
        const e = edits[r.sessionId] ?? {};
        const grade = e.grade ?? (r.sent ? String(r.sent.grade) : r.suggestedGrade !== null ? String(r.suggestedGrade) : "");
        const userId = e.userId ?? r.userId ?? "";
        const n = Number(grade.replace(",", "."));
        const valid = grade.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= (q.data?.link.maxPoints ?? 0) && Boolean(userId);
        return { ...r, grade, userId, n, valid, on: (e.on ?? (valid && !r.sent)) && valid };
      }),
    [q.data, edits],
  );
  const chosen = rows.filter((r) => r.on);
  const edit = (id: string, patch: { grade?: string; userId?: string; on?: boolean }) => setEdits((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Pasar notas a Classroom"
      description={q.data ? `${q.data.link.courseName} · sobre ${q.data.link.maxPoints} puntos. La nota sale de la rúbrica: revisala antes de pasarla.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            disabled={!chosen.length}
            loading={send.isPending}
            icon={<Send className="size-4" />}
            onClick={() =>
              send.mutate(
                { items: chosen.map((r) => ({ sessionId: r.sessionId, userId: r.userId, grade: r.n })), returnToStudents: giveBack },
                {
                  onSuccess: (res) => {
                    setFailed(Object.fromEntries(res.failed.map((f) => [f.sessionId, f.message])));
                    setEdits({});
                    if (res.sent) toast.success(`${plural(res.sent, "nota pasada", "notas pasadas")} a Classroom`);
                    if (res.failed.length) toast.error(`${plural(res.failed.length, "nota no se pudo pasar", "notas no se pudieron pasar")}: mirá el detalle.`);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            {chosen.length ? `Pasar ${plural(chosen.length, "nota", "notas")}` : "Pasar notas"}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <p className="text-[14px] text-rose" role="alert">
          {errorMessage(q.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-text-2">Todavía nadie hizo esta actividad.</p>
      ) : (
        <div className="grid gap-3">
          <div className="hidden grid-cols-[24px_minmax(0,1.2fr)_90px_minmax(0,1.3fr)] gap-3 px-1 text-[12px] font-medium text-text-3 sm:grid">
            <span />
            <span>Alumno</span>
            <span>Nota</span>
            <span>En Classroom</span>
          </div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {rows.map((r) => (
              <li key={r.sessionId} className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[24px_minmax(0,1.2fr)_90px_minmax(0,1.3fr)]">
                <Checkbox checked={r.on} onCheckedChange={(v) => edit(r.sessionId, { on: v })} label={<span className="sr-only">Pasar la nota de {r.studentName}</span>} disabled={!r.valid} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-ink">{r.studentName}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1.5">
                    {r.sent ? (
                      <Badge tone="leaf">
                        Pasada: {r.sent.grade} · {fmtRelative(r.sent.at)}
                      </Badge>
                    ) : r.source === "confirmed" ? (
                      <Badge tone="ink">Evaluación confirmada</Badge>
                    ) : r.source === "suggested" ? (
                      <Badge tone="amber">Sugerida por la IA</Badge>
                    ) : (
                      <Badge>Sin evaluación</Badge>
                    )}
                    {failed[r.sessionId] ? <span className="text-[12px] text-rose">{failed[r.sessionId]}</span> : null}
                  </span>
                </span>
                <Input
                  aria-label={`Nota de ${r.studentName}`}
                  inputMode="decimal"
                  value={r.grade}
                  onChange={(e) => edit(r.sessionId, { grade: e.target.value, on: true })}
                  className="col-start-2 h-10 sm:col-start-auto"
                />
                <div className="col-start-2 sm:col-start-auto">
                  <Select
                    aria-label={`Alumno de Classroom para ${r.studentName}`}
                    value={r.userId}
                    onChange={(e) => edit(r.sessionId, { userId: e.target.value, on: true })}
                    className="h-10"
                  >
                    <option value="">Elegí quién es</option>
                    {q.data.roster.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
          <Checkbox
            checked={giveBack}
            onCheckedChange={setGiveBack}
            label="Devolver los trabajos"
            description="Así cada alumno ve su nota en Classroom. Si lo destildás, la nota queda como borrador para vos."
          />
          {rows.some((r) => !r.userId) ? (
            <Notice tone="amber">Elegí en Classroom a los alumnos que no reconocimos por el nombre: la próxima vez ya quedan emparejados.</Notice>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/** «Mi espacio»: which Google account is connected, and a way out. */
export function ClassroomAccount() {
  const status = useClassroomStatus();
  const disconnect = useDisconnectClassroom();
  if (!status.data?.available) return null;
  const s = status.data;
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-1" aria-labelledby="classroom-account" data-tour="classroom-cuenta">
      <div className="flex items-start gap-3">
        <ClassroomMark />
        <div className="min-w-0 flex-1">
          <h2 id="classroom-account" className="text-[16px] font-semibold tracking-[-0.02em] text-ink">
            Google Classroom
          </h2>
          <p className="mt-1 text-[14px] leading-6 text-text-2">
            {s.connected
              ? `Conectado como ${s.email}. Subís actividades como tareas, traés alumnos y pasás notas.`
              : "Conectá tu cuenta para subir actividades como tareas, traer los alumnos de un curso y pasar las notas."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {s.connected ? (
              <>
                {s.missingScopes ? (
                  <a href={connectUrl("/app/cuenta")} className={buttonClass("primary")}>
                    Volver a conectar (faltan permisos)
                  </a>
                ) : null}
                <Button
                  variant="secondary"
                  loading={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(undefined, {
                      onSuccess: () => toast.success("Google Classroom desconectado"),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  Desconectar
                </Button>
              </>
            ) : (
              <a href={connectUrl("/app/cuenta")} className={buttonClass("primary")}>
                Conectar Google Classroom
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Aula › Alumnos: bring the students of a Classroom course. */
export function ImportFromClassroom({ classroomId }: { classroomId: string }) {
  const status = useClassroomStatus();
  const [open, setOpen] = useState(false);
  if (!status.data?.available) return null;
  if (!status.data.connected) {
    return (
      <a href={connectUrl(`${window.location.pathname}?tab=alumnos`)} className={buttonClass("secondary")}>
        <Users className="size-4" aria-hidden="true" />
        Traer de Classroom
      </a>
    );
  }
  return (
    <>
      <Button variant="secondary" icon={<Users className="size-4" />} onClick={() => setOpen(true)}>
        Traer de Classroom
      </Button>
      {open ? <ImportDialog classroomId={classroomId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportDialog({ classroomId, onClose }: { classroomId: string; onClose: () => void }) {
  const courses = useClassroomCourses(true);
  const run = useImportRoster(classroomId);
  const [courseId, setCourseId] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? undefined : onClose())}
      title="Traer alumnos de Classroom"
      description="Se suman con su nombre los alumnos del curso que elijas. Los que ya están en el aula no se repiten."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!courseId}
            loading={run.isPending}
            onClick={() =>
              run.mutate(courseId, {
                onSuccess: (r) => {
                  toast.success(r.added ? `${plural(r.added, "alumno sumado", "alumnos sumados")}` : "Ya estaban todos en el aula");
                  onClose();
                },
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Traer alumnos
          </Button>
        </>
      }
    >
      {courses.isPending ? (
        <Skeleton className="h-11 w-full" />
      ) : courses.isError ? (
        <p className="text-[14px] text-rose" role="alert">
          {errorMessage(courses.error)}
        </p>
      ) : (
        <label className="grid gap-1.5 text-[13px] font-medium text-text-2">
          Curso de Classroom
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">Elegí un curso</option>
            {(courses.data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.section ? `${c.name} · ${c.section}` : c.name}
              </option>
            ))}
          </Select>
        </label>
      )}
    </Dialog>
  );
}

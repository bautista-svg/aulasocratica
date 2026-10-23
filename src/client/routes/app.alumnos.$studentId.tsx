import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, ChevronRight, FileText, LayoutList } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader } from "@client/components/ui/misc";
import { buttonClass } from "@client/components/ui/button";
import { ApiError } from "@client/lib/api";
import { usePageTitle } from "@client/lib/page-title";
import { PageSpinner } from "@client/components/ui/spinner";
import { fmtDate, fmtRelative, plural } from "@client/lib/format";
import { useStudent } from "@client/features/students/api";
import { WorkStatusBadge } from "@client/features/live/bits";
import { StudentSkills } from "@client/features/skills/student-section";

export const Route = createFileRoute("/app/alumnos/$studentId")({
  component: StudentPage,
});

function StudentPage() {
  const { studentId } = Route.useParams();
  const q = useStudent(studentId);
  usePageTitle(q.data ? [q.data.student.fullName, q.data.classroom.name] : q.isError ? "Alumno no encontrado" : "Alumno");
  if (q.isPending) return <PageSpinner />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="grid gap-4">
        <ErrorState error={q.error} onRetry={gone ? undefined : () => void q.refetch()} />
        <Link to="/app/aulas" className={buttonClass("secondary", "md", "justify-self-center")}>
          Ir a mis aulas
        </Link>
      </div>
    );
  }
  const { student, classroom, works, notJoined, skills } = q.data;
  const done = works.filter((w) => w.status === "completed").length;

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 flex flex-wrap items-center text-sm text-text-3">
        <Link to="/app/aulas" className="-my-3 py-3 hover:text-ink">
          Aulas
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <Link to="/app/aulas/$classroomId" params={{ classroomId: classroom.id }} className="-my-3 py-3 hover:text-ink">
          {classroom.name}
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-text-2" aria-current="page">
          {student.fullName}
        </span>
      </nav>
      <PageHeader
        eyebrow={classroom.label}
        title={student.fullName}
        description={
          works.length
            ? `${plural(works.length, "trabajo", "trabajos")} en las actividades de esta aula · ${done} ${done === 1 ? "terminado" : "terminados"}.`
            : "Todavía no hizo ninguna actividad de esta aula."
        }
      />

      <StudentSkills data={skills} />

      {works.length === 0 ? (
        <EmptyState
          icon={<LayoutList className="size-8" />}
          title="Todavía no empezó ninguna actividad"
          description="Cuando entre a una actividad de esta aula con el enlace, su trabajo aparece acá."
        />
      ) : (
        <ul className="space-y-3">
          {works.map((w) => (
            <li key={w.sessionId} className="rounded-lg border border-line bg-surface p-4 shadow-1 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[16px] font-semibold text-ink">{w.activityTitle}</h2>
                    <WorkStatusBadge status={w.status} endedByTeacher={w.endedByTeacher} lastActivityAt={w.lastActivityAt} />
                    {w.openAlerts ? (
                      <Badge tone={w.immediateAlerts ? "rose" : "amber"}>
                        <Bell className="size-3" aria-hidden="true" />
                        {plural(w.openAlerts, "alerta abierta", "alertas abiertas")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-text-3">
                    Empezó el {fmtDate(w.startedAt)}
                    {w.completedAt ? ` · terminó el ${fmtDate(w.completedAt)}` : ` · última actividad ${fmtRelative(w.lastActivityAt)}`}
                  </p>
                </div>
                <Link to="/app/sesiones/$sessionId" params={{ sessionId: w.sessionId }} className={buttonClass("secondary", "sm", "shrink-0 self-start")}>
                  <FileText className="size-4" aria-hidden="true" />
                  Ver trabajo
                </Link>
              </div>
              {w.initialAnswerPreview || w.finalAnswerPreview || w.requireInitialAnswer ? (
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  {w.requireInitialAnswer || w.initialAnswerPreview ? (
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-text-3 uppercase">Respuesta inicial</dt>
                      <dd className="mt-0.5 line-clamp-3 text-text-2">{w.initialAnswerPreview ?? <span className="italic">Todavía no la escribió.</span>}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-text-3 uppercase">Respuesta final</dt>
                    <dd className="mt-0.5 line-clamp-3 text-text-2">{w.finalAnswerPreview ?? <span className="italic">Todavía no la escribió.</span>}</dd>
                  </div>
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {notJoined.length ? (
        <section aria-labelledby="not-joined" className="mt-8">
          <h2 id="not-joined" className="font-display text-lg font-semibold text-ink">
            Actividades publicadas que todavía no hizo
          </h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {notJoined.map((a) => (
              <li key={a.activityId}>
                <Link
                  to="/app/actividades/$activityId"
                  params={{ activityId: a.activityId }}
                  className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 text-[15px] text-text hover:bg-paper"
                >
                  {a.title}
                  <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

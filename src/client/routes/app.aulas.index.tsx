import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, School, Users, LayoutList } from "lucide-react";
import { optionalBoolean, searchParams } from "@client/lib/search";
import { PageHeader, EmptyState, ErrorState, SkeletonList, Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";
import { plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { useClassrooms } from "@client/features/classrooms/api";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";

export const Route = createFileRoute("/app/aulas/")({
  validateSearch: searchParams({ archivadas: optionalBoolean }),
  component: ClassroomsPage,
});

function ClassroomsPage() {
  const { archivadas } = Route.useSearch();
  const archived = Boolean(archivadas);
  const q = useClassrooms(archived);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  usePageTitle(["Aulas", archived ? "Archivadas" : null]);

  return (
    <>
      <PageHeader
        title="Aulas"
        description="Cada aula agrupa las actividades y los alumnos de un curso."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nueva aula
          </Button>
        }
      />

      {/* Two links (not tabs): the current one is marked with aria-current="page" only (D18). */}
      <nav aria-label="Filtrar aulas" className="mb-5 inline-flex rounded-md border border-line bg-surface p-1">
        {[
          { label: "Activas", value: false },
          { label: "Archivadas", value: true },
        ].map((t) => (
          <Link
            key={t.label}
            to="/app/aulas"
            search={t.value ? { archivadas: true } : {}}
            // Exact match: "Activas" (no search) must not read as current while "Archivadas" is open.
            activeOptions={{ exact: true }}
            className={cn(
              "inline-flex min-h-11 items-center rounded-sm px-4 text-sm font-semibold transition-colors",
              archived === t.value ? "bg-ink text-white" : "text-text-2 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {q.isPending ? (
        <SkeletonList rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        archived ? (
          <EmptyState icon={<School className="size-8" />} title="No hay aulas archivadas" description="Cuando archives un aula, va a aparecer acá y la vas a poder restaurar." />
        ) : (
          <EmptyState
            icon={<School className="size-8" />}
            title="Todavía no creaste aulas"
            description="Creá un aula por curso. Después le agregás actividades y compartís el enlace con tus alumnos."
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Crear mi primera aula
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link
                to="/app/aulas/$classroomId"
                params={{ classroomId: c.id }}
                className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 shadow-1 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl leading-snug font-semibold text-ink group-hover:underline group-hover:decoration-lilac group-hover:underline-offset-4">
                    {c.name}
                  </h2>
                  {c.activeNow > 0 ? (
                    <Badge tone="leaf" dot className="shrink-0">
                      {c.activeNow} ahora
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-text-2">
                  {[c.subject, [c.grade, c.division].filter(Boolean).join(" "), c.school].filter(Boolean).join(" · ") || "Sin datos de curso"}
                </p>
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-5 text-sm text-text-3">
                  <span className="inline-flex items-center gap-1.5">
                    <LayoutList className="size-4" aria-hidden="true" />
                    {plural(c.activityCount, "actividad", "actividades")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-4" aria-hidden="true" />
                    {plural(c.studentCount, "alumno", "alumnos")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ClassroomFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(c) => void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: c.id } })}
      />
    </>
  );
}

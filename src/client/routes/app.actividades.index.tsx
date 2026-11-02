import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronRight, LayoutList, Plus, Sparkles } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button, ButtonLink } from "@client/components/ui/button";
import { Menu } from "@client/components/ui/controls";
import { cn } from "@client/lib/cn";
import { fmtRelative, plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { useAllActivities } from "@client/features/dashboard/api";
import { useClassrooms } from "@client/features/classrooms/api";
import { NewActivityDialog } from "@client/features/activities/new-activity-dialog";
import { activityState } from "@shared/domain/activity-state";
import type { DashboardActivity } from "@shared/contracts/dashboard";
import { roomColor, roomInitials } from "@client/lib/room-color";

export const Route = createFileRoute("/app/actividades/")({
  component: ActivitiesPage,
});

type Filter = "todas" | "abiertas" | "borradores" | "cerradas";
const FILTERS: { value: Filter; label: string; test: (a: DashboardActivity) => boolean }[] = [
  { value: "todas", label: "Todas", test: () => true },
  { value: "abiertas", label: "Abiertas", test: (a) => activityState(a).open },
  { value: "borradores", label: "Borradores", test: (a) => a.status === "draft" },
  { value: "cerradas", label: "Cerradas", test: (a) => a.status !== "draft" && !activityState(a).open },
];

function ActivitiesPage() {
  usePageTitle("Actividades");
  const q = useAllActivities();
  const rooms = useClassrooms(false, "editable");
  const [filter, setFilter] = useState<Filter>("todas");
  const [newIn, setNewIn] = useState<string | null>(null);

  const editable = rooms.data ?? [];
  const newButton =
    editable.length === 0 ? (
      <ButtonLink to="/app/aulas" variant="secondary" icon={<Plus className="size-4" />} data-tour="nueva-actividad">
        Nueva actividad
      </ButtonLink>
    ) : editable.length === 1 ? (
      <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setNewIn(editable[0]!.id)} data-tour="nueva-actividad">
        Nueva actividad
      </Button>
    ) : (
      <Menu
        trigger={
          <Button variant="secondary" icon={<Plus className="size-4" />} data-tour="nueva-actividad">
            Nueva actividad <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        }
        items={editable.map((r) => ({ label: `En ${r.name}`, onSelect: () => setNewIn(r.id) }))}
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Preparar"
        title="Actividades"
        description="Todas tus actividades, de todas tus aulas. Una actividad es la consigna, el tutor y tu material."
        actions={
          <>
            {newButton}
            <ButtonLink to="/app/crear" icon={<Sparkles className="size-4" />} data-tour="crear-ia">
              Crear con IA
            </ButtonLink>
          </>
        }
      />

      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.activities.length === 0 ? (
        <EmptyState
          level={2}
          icon={<LayoutList className="size-8" />}
          title="Todavía no hay actividades"
          description={editable.length ? "Creá la primera: escribila vos o pedile a la IA que la arme con tu material." : "Primero creá un aula; después le sumás actividades."}
          action={
            editable.length ? (
              <ButtonLink to="/app/crear" icon={<Sparkles className="size-4" />}>
                Crear con IA
              </ButtonLink>
            ) : (
              <ButtonLink to="/app/aulas">Ir a Aulas</ButtonLink>
            )
          }
        />
      ) : (
        <ActivityList all={q.data.activities} filter={filter} onFilter={setFilter} />
      )}

      {newIn ? <NewActivityDialog classroomId={newIn} open onOpenChange={(o) => !o && setNewIn(null)} /> : null}
    </>
  );
}

function ActivityList({ all, filter, onFilter }: { all: DashboardActivity[]; filter: Filter; onFilter: (f: Filter) => void }) {
  const test = FILTERS.find((f) => f.value === filter)!.test;
  const shown = all.filter(test);
  const groups = new Map<string, { name: string; items: DashboardActivity[] }>();
  for (const a of shown) {
    const g = groups.get(a.classroomId) ?? { name: a.classroomName, items: [] };
    g.items.push(a);
    groups.set(a.classroomId, g);
  }
  return (
    <div className="grid gap-6" data-tour="lista-actividades">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="group" aria-label="Filtrar actividades">
        {FILTERS.map((f) => {
          const n = all.filter(f.test).length;
          const on = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(f.value)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-colors max-sm:h-11",
                on ? "border-lilac-ink/30 bg-lilac-soft text-lilac-ink" : "border-line bg-surface text-text-2 hover:text-ink",
              )}
            >
              {f.label}
              <span className={cn("tabular text-[12px]", on ? "text-lilac-ink" : "text-text-3")}>{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? <p className="text-[14px] text-text-2">No hay actividades con este filtro.</p> : null}
      {[...groups.entries()].map(([roomId, g]) => (
        <section key={roomId} aria-label={g.name}>
          <h2 className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
            <span className="initial size-6 rounded-md text-[10.5px]" style={{ ["--c" as string]: roomColor(roomId) }} aria-hidden="true">
              {roomInitials(g.name)}
            </span>
            <Link to="/app/aulas/$classroomId" params={{ classroomId: roomId }} className="hover:underline">
              {g.name}
            </Link>
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
            {g.items.map((a) => {
              const st = activityState(a);
              return (
                <li key={a.id}>
                  <Link
                    to="/app/actividades/$activityId"
                    params={{ activityId: a.id }}
                    className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-ink">{a.title}</span>
                      <span className={cn("block truncate text-[12.5px]", a.activeNow > 0 ? "font-medium text-leaf" : "text-text-3")}>
                        {a.activeNow > 0
                          ? `${plural(a.activeNow, "alumno trabajando", "alumnos trabajando")} ahora`
                          : a.participants > 0
                            ? `${plural(a.participants, "alumno", "alumnos")} · ${a.completed} ${a.completed === 1 ? "terminó" : "terminaron"}`
                            : `Editada ${fmtRelative(a.updatedAt)}`}
                      </span>
                    </span>
                    {a.openAlerts > 0 ? <Badge tone="rose">{plural(a.openAlerts, "aviso", "avisos")}</Badge> : null}
                    <Badge tone={st.tone} dot={st.open}>
                      {st.label}
                    </Badge>
                    <ChevronRight className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

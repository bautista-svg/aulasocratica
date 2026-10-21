import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChevronRight, ScanSearch } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Field, Input, Select } from "@client/components/ui/field";
import { api } from "@client/lib/api";
import { fmtRelative, plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { useClassrooms, classroomKeys } from "@client/features/classrooms/api";
import { useXrayList } from "@client/features/sessions/api";
import { WorkStatusBadge } from "@client/features/live/bits";
import type { ActivitySummary } from "@shared/contracts/activities";
import type { XrayListItem } from "@shared/contracts/sessions";

export const Route = createFileRoute("/app/radiografia")({
  validateSearch: z.object({ aula: z.string().optional(), actividad: z.string().optional(), q: z.string().optional() }),
  component: XrayListPage,
});

function useActivitiesOf(classroomId: string | undefined) {
  return useQuery({
    queryKey: classroomKeys.activities(classroomId ?? "none"),
    queryFn: ({ signal }) => api.get<{ activities: ActivitySummary[] }>(`/api/classrooms/${classroomId}/activities`, signal),
    select: (d) => d.activities,
    enabled: Boolean(classroomId),
  });
}

function XrayListPage() {
  const { aula, actividad, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const classrooms = useClassrooms(false);
  // Works of archived classrooms are listed too, so their classrooms can be picked as a filter — marked (D21).
  const archivedRooms = useClassrooms(true);
  const activities = useActivitiesOf(aula);
  usePageTitle("Radiografía del pensamiento");
  const [search, setSearch] = useState(q ?? "");
  useEffect(() => {
    const id = setTimeout(() => {
      if ((q ?? "") !== search.trim()) void navigate({ search: (s) => ({ ...s, q: search.trim() || undefined }), replace: true });
    }, 350);
    return () => clearTimeout(id);
  }, [search, q, navigate]);
  const list = useXrayList({ classroomId: aula, activityId: actividad, q });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Boolean(aula || actividad || q);

  return (
    <>
      <PageHeader
        title="Radiografía del pensamiento"
        description="Para cada trabajo, la IA propone interpretaciones de cómo pensó el alumno antes, durante y después de hablar con el tutor, siempre citando algo que escribió. Vos las validás, editás o descartás: solo corre cuando la pedís desde el trabajo."
      />

      <div className="mb-5 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-1 sm:grid-cols-3">
        <Field label="Aula">
          {({ id }) => (
            <Select
              id={id}
              value={aula ?? ""}
              onChange={(e) => void navigate({ search: (s) => ({ ...s, aula: e.target.value || undefined, actividad: undefined }), replace: true })}
            >
              <option value="">Todas las aulas</option>
              {(classrooms.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {archivedRooms.data?.length ? (
                <optgroup label="Archivadas">
                  {archivedRooms.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (archivada)
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          )}
        </Field>
        <Field label="Actividad" hint={!aula ? "Elegí un aula para filtrar por actividad." : undefined}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={actividad ?? ""}
              disabled={!aula || activities.isPending}
              onChange={(e) => void navigate({ search: (s) => ({ ...s, actividad: e.target.value || undefined }), replace: true })}
            >
              <option value="">Todas las actividades</option>
              {(activities.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Buscar alumno">
          {({ id }) => <Input id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre" autoComplete="off" />}
        </Field>
      </div>

      {list.isPending ? (
        <SkeletonList rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ScanSearch className="size-8" />}
          title={filtered ? "No hay trabajos con estos filtros" : "Todavía no hay trabajos para analizar"}
          description={filtered ? "Probá con otra aula, otra actividad u otro nombre." : "Cuando tus alumnos hagan una actividad, sus trabajos aparecen acá."}
        />
      ) : (
        <>
          <ul className="space-y-2.5" aria-live="polite">
            {items.map((it) => (
              <XrayRow key={it.sessionId} it={it} />
            ))}
          </ul>
          <div className="mt-4 flex flex-col items-center gap-2">
            {list.hasNextPage ? (
              <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Ver más trabajos
              </Button>
            ) : (
              <p className="text-sm text-text-3">{plural(items.length, "trabajo", "trabajos")} en total.</p>
            )}
            {list.isFetchNextPageError ? <p className="text-sm text-rose">No se pudieron cargar más. Probá de nuevo.</p> : null}
          </div>
        </>
      )}
    </>
  );
}

function XrayStatus({ x }: { x: XrayListItem["xray"] }) {
  if (!x.analyzed || x.validated + x.suggested === 0) {
    return <Badge tone="neutral">{x.analyzed ? "Sin interpretaciones" : "Sin analizar"}</Badge>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {x.validated ? <Badge tone="leaf">{plural(x.validated, "validada", "validadas")}</Badge> : null}
      {x.suggested ? <Badge tone="amber">{x.suggested} por revisar</Badge> : null}
    </span>
  );
}

function XrayRow({ it }: { it: XrayListItem }) {
  return (
    <li>
      <Link
        to="/app/sesiones/$sessionId"
        params={{ sessionId: it.sessionId }}
        search={{ tab: "radiografia" }}
        className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3.5 shadow-1 transition-colors hover:border-ink/30 hover:bg-paper sm:flex-row sm:items-center sm:justify-between sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-ink">{it.studentName}</span>
            <WorkStatusBadge status={it.status} endedByTeacher={it.endedByTeacher} lastActivityAt={it.lastActivityAt} />
          </div>
          <p className="mt-0.5 truncate text-sm text-text-2">
            {it.activityTitle} · {it.classroomName}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm text-text-3">
          <XrayStatus x={it.xray} />
          <span>{it.completedAt ? `Terminó ${fmtRelative(it.completedAt)}` : `Última actividad ${fmtRelative(it.lastActivityAt)}`}</span>
          <ChevronRight className="hidden size-4 sm:block" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}

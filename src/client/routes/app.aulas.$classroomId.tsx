import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Trash2, LayoutList, ChevronRight, Bell } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList, Notice } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Menu, Tabs } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { PageSpinner } from "@client/components/ui/spinner";
import { errorMessage } from "@client/lib/api";
import { fmtRelative, plural } from "@client/lib/format";
import { useClassroom, useClassroomActivities, useDeleteClassroom, useSaveClassroom } from "@client/features/classrooms/api";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";
import { StudentsPanel } from "@client/features/classrooms/students-panel";
import { AlertsPanel } from "@client/features/classrooms/alerts-panel";
import { NewActivityDialog } from "@client/features/activities/new-activity-dialog";
import { activityState } from "@shared/domain/activity-state";

const TABS = ["actividades", "alumnos", "alertas"] as const;

export const Route = createFileRoute("/app/aulas/$classroomId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional(), actividad: z.string().optional() }),
  component: ClassroomPage,
});

function ClassroomPage() {
  const { classroomId } = Route.useParams();
  const { tab = "actividades", actividad } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const room = useClassroom(classroomId);
  const save = useSaveClassroom();
  const del = useDeleteClassroom();
  const [editing, setEditing] = useState(false);
  const [newActivity, setNewActivity] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (room.isPending) return <PageSpinner />;
  if (room.isError) return <ErrorState error={room.error} onRetry={() => void room.refetch()} />;
  const c = room.data;
  const meta = [c.subject, [c.grade, c.division].filter(Boolean).join(" "), c.school].filter(Boolean).join(" · ");

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 text-sm text-text-3">
        <Link to="/app/aulas" className="hover:text-ink">
          Aulas
        </Link>
        <ChevronRight className="mx-1 inline size-3.5" aria-hidden="true" />
        <span className="text-text-2">{c.name}</span>
      </nav>
      <PageHeader
        title={c.name}
        description={meta || undefined}
        actions={
          <>
            {!c.isArchived ? (
              <Button icon={<Plus className="size-4" />} onClick={() => setNewActivity(true)}>
                Nueva actividad
              </Button>
            ) : null}
            <Menu
              trigger={
                <Button variant="secondary" size="icon" aria-label="Más opciones del aula">
                  <MoreHorizontal className="size-5" />
                </Button>
              }
              items={[
                { label: "Editar datos del aula", icon: <Pencil className="size-4" />, onSelect: () => setEditing(true) },
                c.isArchived
                  ? {
                      label: "Restaurar aula",
                      icon: <ArchiveRestore className="size-4" />,
                      onSelect: () =>
                        save.mutate({ id: c.id, data: { isArchived: false } }, { onSuccess: () => toast.success("Aula restaurada"), onError: (e) => toast.error(errorMessage(e)) }),
                    }
                  : {
                      label: "Archivar aula",
                      icon: <Archive className="size-4" />,
                      onSelect: () =>
                        save.mutate(
                          { id: c.id, data: { isArchived: true } },
                          { onSuccess: () => toast.success("Aula archivada. Sus enlaces quedan cerrados."), onError: (e) => toast.error(errorMessage(e)) },
                        ),
                    },
                "separator",
                { label: "Eliminar aula", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirmDelete(true) },
              ]}
            />
          </>
        }
      />

      {c.isArchived ? (
        <Notice tone="amber" className="mb-5" title="Esta aula está archivada">
          Sus actividades no reciben alumnos. Restaurala para volver a abrirlas.
        </Notice>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ search: (s) => ({ ...s, tab: v as (typeof TABS)[number] }), replace: true })}
        items={[
          { value: "actividades", label: "Actividades", content: <ActivitiesPanel classroomId={c.id} onNew={() => setNewActivity(true)} archived={c.isArchived} /> },
          { value: "alumnos", label: "Alumnos", content: <StudentsPanel classroomId={c.id} activityFilter={actividad} onFilterChange={(a) => void navigate({ search: (s) => ({ ...s, actividad: a || undefined }), replace: true })} /> },
          { value: "alertas", label: "Alertas", content: <AlertsPanel classroomId={c.id} /> },
        ]}
      />

      <ClassroomFormDialog open={editing} onOpenChange={setEditing} classroom={c} />
      <NewActivityDialog classroomId={c.id} open={newActivity} onOpenChange={setNewActivity} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar esta aula para siempre?"
        description={
          <>
            <p>
              Se borran sus {plural(c.activityCount, "actividad", "actividades")}, sus {plural(c.studentCount, "alumno", "alumnos")}, todas las conversaciones
              con el tutor y los archivos subidos.
            </p>
            <p className="font-semibold text-text">No se puede deshacer. Si solo querés ocultarla, archivala.</p>
          </>
        }
        confirmLabel="Eliminar para siempre"
        typeToConfirm="BORRAR"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(c.id, {
            onSuccess: () => {
              toast.success("Aula eliminada");
              void navigate({ to: "/app/aulas" });
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}

function ActivitiesPanel({ classroomId, onNew, archived }: { classroomId: string; onNew: () => void; archived: boolean }) {
  const q = useClassroomActivities(classroomId);
  if (q.isPending) return <SkeletonList rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <EmptyState
        icon={<LayoutList className="size-8" />}
        title="Esta aula todavía no tiene actividades"
        description="Creá una actividad, publicala y compartí el enlace. Cada alumno aparece en la actividad que hizo."
        action={
          archived ? undefined : (
            <Button icon={<Plus className="size-4" />} onClick={onNew}>
              Nueva actividad
            </Button>
          )
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
      {q.data.map((a) => {
        const st = activityState(a);
        return (
          <li key={a.id}>
            <Link
              to="/app/actividades/$activityId"
              params={{ activityId: a.id }}
              className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-paper sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[16px] font-semibold text-ink">{a.title}</span>
                  <Badge tone={st.tone} dot={st.open}>
                    {st.label}
                  </Badge>
                  {a.openAlerts > 0 ? (
                    <Badge tone="rose">
                      <Bell className="size-3" aria-hidden="true" />
                      {plural(a.openAlerts, "alerta", "alertas")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-text-3">Editada {fmtRelative(a.updatedAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-sm text-text-2">
                {a.activeNow > 0 ? <span className="font-semibold text-leaf">{a.activeNow} trabajando ahora</span> : null}
                <span className="tabular">
                  {a.participants === 0 ? "Sin participantes" : `${plural(a.participants, "alumno", "alumnos")} · ${a.completed} terminaron`}
                </span>
                <ChevronRight className="hidden size-4 text-text-3 sm:block" aria-hidden="true" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

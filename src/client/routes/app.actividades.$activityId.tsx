import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { optionalEnum, searchParams } from "@client/lib/search";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronRight, Copy, MoreHorizontal, RotateCcw, Send, Share2, Trash2, Undo2 } from "lucide-react";
import { Badge, ErrorState, Notice, Skeleton } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Menu, Tabs } from "@client/components/ui/controls";
import { ApiError, errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { LivePanel } from "@client/features/live/live-panel";
import { SkillsPanel } from "@client/features/skills/group-panel";
import { useActivity, useActivityAction, useSaveActivity } from "@client/features/activities/api";
import { useActivityForm } from "@client/features/activities/use-activity-form";
import { ConfigPanel, scrollToSection, useSaveDraft } from "@client/features/activities/config-panel";
import { SharePanel } from "@client/features/activities/share-panel";
import { InlineTitle } from "@client/features/activities/parts";
import { LifecycleDialogs, type LifecycleDialog } from "@client/features/activities/lifecycle-dialogs";
import { UnsavedGuard } from "@client/features/activities/unsaved-guard";
import { activityState } from "@shared/domain/activity-state";
import type { ActivityEditorData } from "@shared/contracts/activities";

const TABS = ["configuracion", "compartir", "en-vivo", "fortalezas"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { configuracion: "Configuración", compartir: "Compartir", "en-vivo": "En vivo", fortalezas: "Fortalezas" };

export const Route = createFileRoute("/app/actividades/$activityId")({
  validateSearch: searchParams({ tab: optionalEnum(TABS) }),
  component: ActivityPage,
});

function ActivityPage() {
  const { activityId } = Route.useParams();
  const q = useActivity(activityId);
  const { tab } = Route.useSearch();
  // One title for the whole screen (a child effect would be overwritten by this one): "Título · En vivo · Aula Socrática".
  usePageTitle(
    q.data
      ? [q.data.title, TAB_LABELS[tab ?? (q.data.status === "published" ? "en-vivo" : "configuracion")]]
      : q.isError
        ? "Actividad no encontrada"
        : "Actividad",
  );
  if (q.isPending) return <ActivitySkeleton />;
  if (q.isError) {
    return (
      <div className="grid gap-4">
        <ErrorState error={q.error} onRetry={q.error instanceof ApiError && q.error.status === 404 ? undefined : () => void q.refetch()} />
        <Link to="/app/aulas" className={buttonClass("secondary", "md", "justify-self-center")}>
          Ir a mis aulas
        </Link>
      </div>
    );
  }
  return <ActivityEditor key={q.data.id} activity={q.data} />;
}

function ActivityEditor({ activity }: { activity: ActivityEditorData }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const goTab = useCallback((t: Tab) => void navigate({ search: (s) => ({ ...s, tab: t }), replace: true }), [navigate]);

  const form = useActivityForm(activity);
  const draftSave = useSaveDraft(activity, form, () => goTab("configuracion"));
  const action = useActivityAction(activity.id);
  const rename = useSaveActivity(activity.id);
  const [dialog, setDialog] = useState<LifecycleDialog>(null);
  const bypass = useRef(false);
  const state = activityState(activity);
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    const hadChanges = form.dirty;
    setPublishing(true);
    if (!(await draftSave.run({ quiet: true }))) {
      setPublishing(false);
      return;
    }
    action.mutate("publish", {
      onSettled: () => setPublishing(false),
      onSuccess: () => {
        toast.success(hadChanges ? "Cambios guardados y actividad publicada" : "Actividad publicada: ya tiene su enlace");
        goTab("compartir");
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fields.instructions) {
          form.setErrors(e.fields);
          goTab("configuracion");
          scrollToSection("consigna");
        }
        toast.error(errorMessage(e));
      },
    });
  }

  const restore = () =>
    action.mutate("restore", {
      onSuccess: () => toast.success("Actividad restaurada como borrador"),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const primary =
    activity.status === "archived" ? (
      <Button icon={<ArchiveRestore className="size-4" />} loading={action.isPending && action.variables === "restore"} onClick={restore}>
        Restaurar
      </Button>
    ) : activity.classroomArchived ? (
      // Its classroom is archived: there is nothing to share until the classroom is restored.
      <Link to="/app/aulas/$classroomId" params={{ classroomId: activity.classroomId }} className={buttonClass("secondary")}>
        <ArchiveRestore className="size-4" aria-hidden="true" />
        Ir al aula para restaurarla
      </Link>
    ) : activity.status === "published" ? (
      <Button icon={<Share2 className="size-4" />} onClick={() => goTab("compartir")}>
        Compartir
      </Button>
    ) : (
      <Button icon={<Send className="size-4" />} loading={publishing} onClick={() => void publish()} disabled={activity.classroomArchived}>
        Publicar
      </Button>
    );

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 flex min-w-0 items-center text-sm text-text-3">
        <Link to="/app/aulas" className="-my-3 shrink-0 py-3 hover:text-ink">
          Aulas
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <Link to="/app/aulas/$classroomId" params={{ classroomId: activity.classroomId }} className="-my-3 min-w-0 truncate py-3 hover:text-ink">
          {activity.classroomName}
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <span aria-current="page" className="min-w-0 truncate text-text-2">
          {activity.title}
        </span>
      </nav>

      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <InlineTitle
            value={activity.title}
            saving={rename.isPending}
            onSave={async (title) => {
              await rename.mutateAsync({ title });
              toast.success("Título guardado");
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Badge tone={state.tone} dot={state.open}>
              {state.label}
            </Badge>
            <span className="text-sm text-text-3">
              {activity.participants === 0
                ? "Todavía sin alumnos"
                : `${plural(activity.participants, "alumno", "alumnos")} · ${activity.completed} ${activity.completed === 1 ? "terminó" : "terminaron"}`}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <div className="flex-1 sm:flex-none [&>button]:w-full">{primary}</div>
          <Menu
            trigger={
              <Button variant="secondary" size="icon" aria-label="Más acciones de la actividad" className="h-11 w-11">
                <MoreHorizontal className="size-5" />
              </Button>
            }
            items={[
              ...(activity.status === "published"
                ? [{ label: "Volver a borrador", icon: <Undo2 className="size-4" />, onSelect: () => setDialog("unpublish") }]
                : []),
              { label: "Duplicar", icon: <Copy className="size-4" />, onSelect: () => setDialog("duplicate") },
              { label: "Reiniciar actividad", icon: <RotateCcw className="size-4" />, onSelect: () => setDialog("reset") },
              activity.status === "archived"
                ? { label: "Restaurar", icon: <ArchiveRestore className="size-4" />, onSelect: restore }
                : { label: "Archivar", icon: <Archive className="size-4" />, onSelect: () => setDialog("archive") },
              "separator" as const,
              { label: "Eliminar", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDialog("delete") },
            ]}
          />
        </div>
      </header>

      {activity.classroomArchived ? (
        <Notice tone="amber" className="mb-5" title="El aula está archivada">
          Sus actividades no reciben alumnos. Restaurá el aula para volver a abrirla.
        </Notice>
      ) : activity.status === "archived" ? (
        <Notice tone="amber" className="mb-5" title="Actividad archivada">
          No recibe alumnos. Restaurala para volver a publicarla.
        </Notice>
      ) : null}

      <ActivityTabs
        activity={activity}
        goTab={goTab}
        dirty={form.dirty}
        config={<ConfigPanel activity={activity} form={form} saving={draftSave.pending} onSave={() => void draftSave.run()} />}
        share={<SharePanel activity={activity} onPublish={() => void publish()} publishing={publishing} />}
      />

      <LifecycleDialogs activity={activity} open={dialog} onClose={() => setDialog(null)} onLeave={() => (bypass.current = true)} />
      <UnsavedGuard dirty={form.dirty} onSave={() => draftSave.run()} bypass={bypass} />
    </>
  );
}

/**
 * The tabs read the tab from the URL themselves, so switching tabs re-renders only them: the
 * panels arrive as elements created by the editor and React skips them when they did not change.
 */
function ActivityTabs({
  activity,
  goTab,
  dirty,
  config,
  share,
}: {
  activity: ActivityEditorData;
  goTab: (t: Tab) => void;
  dirty: boolean;
  config: ReactNode;
  share: ReactNode;
}) {
  const { tab } = Route.useSearch();
  const current: Tab = tab ?? (activity.status === "published" ? "en-vivo" : "configuracion");
  // The live view (SSE + polling) starts the first time its tab is opened, then stays mounted.
  const [liveOpened, setLiveOpened] = useState(current === "en-vivo");
  const [aspectsOpened, setAspectsOpened] = useState(current === "fortalezas");
  useEffect(() => {
    if (current === "en-vivo") setLiveOpened(true);
    if (current === "fortalezas") setAspectsOpened(true);
  }, [current]);
  return (
    <Tabs
      value={current}
      onValueChange={(v) => goTab(v as Tab)}
      items={[
        {
          value: "configuracion",
          label: "Configuración",
          badge: dirty ? <span className="size-2 rounded-full bg-amber" aria-label="(con cambios sin guardar)" /> : undefined,
          content: config,
        },
        { value: "compartir", label: "Compartir", content: share },
        {
          value: "en-vivo",
          label: "En vivo",
          badge:
            activity.participants > 0 ? (
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-semibold text-text-2 tabular">{activity.participants}</span>
            ) : undefined,
          content: liveOpened ? <LivePanel activityId={activity.id} /> : null,
        },
        { value: "fortalezas", label: "Fortalezas", content: aspectsOpened ? <SkillsPanel activityId={activity.id} /> : null },
      ]}
    />
  );
}

function ActivitySkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando la actividad">
      <Skeleton className="mb-4 h-4 w-48" />
      <Skeleton className="h-9 w-3/4 max-w-md" />
      <Skeleton className="mt-3 h-5 w-32" />
      <div className="mt-7 flex gap-4 border-b border-line pb-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="mt-5 grid gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-4 w-4/5" />
            <Skeleton className="mt-4 h-24 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

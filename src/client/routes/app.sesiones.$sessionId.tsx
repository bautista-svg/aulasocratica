import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ChevronRight, CircleStop, Download, KeyRound, MoreHorizontal, Play, Trash2, UserRound } from "lucide-react";
import { Badge, ErrorState, PageHeader } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Menu, Tabs } from "@client/components/ui/controls";
import { PageSpinner } from "@client/components/ui/spinner";
import { ApiError, errorMessage } from "@client/lib/api";
import { fmtDateTime, fmtRelative, plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { sessionKeys, useJourneyDownload, useSession, useSessionMutations } from "@client/features/sessions/api";
import { useActivityStream, useLiveMutations, useThrottled } from "@client/features/live/api";
import { AlertItem, LiveStatusLabel, StageProgress } from "@client/features/live/bits";
import { DeleteWorkDialog, EndWorkDialog, ResumeCodeDialog } from "@client/features/sessions/dialogs";
import { RecorridoTab } from "@client/features/sessions/recorrido";
import { ConversationTab } from "@client/features/sessions/conversation";
import { EvaluationTab } from "@client/features/sessions/evaluation";
import { XrayTab } from "@client/features/sessions/xray";
import type { SessionDetail } from "@shared/contracts/sessions";

const TABS = ["recorrido", "conversacion", "evaluacion", "radiografia"] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  recorrido: "Recorrido",
  conversacion: "Conversación",
  evaluacion: "Evaluación",
  radiografia: "Radiografía",
};

export const Route = createFileRoute("/app/sesiones/$sessionId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const { tab = "recorrido" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const q = useSession(sessionId);
  const live = q.data?.session.status === "in_progress";
  const refetch = useThrottled(() => void qc.invalidateQueries({ queryKey: sessionKeys.one(sessionId) }), 1200);
  useActivityStream(
    q.data?.activity.id,
    (e) => {
      if (e.sessionIds.length === 0 || e.sessionIds.includes(sessionId)) refetch();
    },
    live,
  );
  usePageTitle(q.data ? [q.data.student.fullName, q.data.activity.title, TAB_LABELS[tab]] : [q.isError ? "Trabajo no encontrado" : "Trabajo del alumno"]);

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
  const d = q.data;

  return (
    <>
      <nav aria-label="Ruta" className="mb-3 flex flex-wrap items-center text-sm text-text-3">
        <Link to="/app/aulas" className="-my-3 py-3 hover:text-ink">
          Aulas
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <Link to="/app/aulas/$classroomId" params={{ classroomId: d.classroom.id }} className="-my-3 max-w-40 truncate py-3 hover:text-ink sm:max-w-none">
          {d.classroom.name}
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <Link to="/app/actividades/$activityId" params={{ activityId: d.activity.id }} className="-my-3 max-w-40 truncate py-3 hover:text-ink sm:max-w-none">
          {d.activity.title}
        </Link>
        <ChevronRight className="mx-1 size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-text-2" aria-current="page">
          {d.student.fullName}
        </span>
      </nav>

      <Header d={d} />

      <OpenAlerts d={d} />

      <Tabs
        value={tab}
        onValueChange={(v) => void navigate({ search: (s) => ({ ...s, tab: v as (typeof TABS)[number] }), replace: true })}
        items={[
          { value: "recorrido", label: "Recorrido", content: <RecorridoTab detail={d} /> },
          {
            value: "conversacion",
            label: "Conversación",
            badge: live ? <span className="size-2 animate-pulse-dot rounded-full bg-leaf-bright" aria-label="en vivo" /> : undefined,
            content: <ConversationTab detail={d} live={live} />,
          },
          {
            value: "evaluacion",
            label: "Evaluación",
            badge: d.rubric.status === "confirmed" ? <Badge tone="leaf">Confirmada</Badge> : undefined,
            content: <EvaluationTab detail={d} />,
          },
          { value: "radiografia", label: "Radiografía", content: <XrayTab detail={d} /> },
        ]}
      />
    </>
  );
}

function Header({ d }: { d: SessionDetail }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useSessionMutations(d.session.id);
  const pdf = useJourneyDownload();
  const [ending, setEnding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const s = d.session;
  const inProgress = s.status === "in_progress";

  return (
    <>
      <PageHeader
        eyebrow={d.activity.title}
        title={d.student.fullName}
        actions={
          <>
            <Button icon={<Download className="size-4" />} loading={pdf.busyId === s.id} onClick={() => void pdf.download(s.id)}>
              Descargar PDF del recorrido
            </Button>
            {inProgress ? (
              <Button variant="secondary" icon={<CircleStop className="size-4" />} onClick={() => setEnding(true)}>
                Terminar
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<Play className="size-4" />}
                loading={m.reopen.isPending}
                onClick={() =>
                  m.reopen.mutate(d.activity.id, {
                    onSuccess: () => toast.success(`${d.student.fullName} puede continuar su trabajo`),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              >
                Permitir continuar
              </Button>
            )}
            <Menu
              trigger={
                <Button variant="secondary" size="icon" aria-label="Más acciones" className="size-11">
                  <MoreHorizontal className="size-5" />
                </Button>
              }
              items={[
                { label: "Todos sus trabajos", icon: <UserRound className="size-4" />, onSelect: () => void navigate({ to: "/app/alumnos/$studentId", params: { studentId: d.student.id } }) },
                { label: "Mostrar código para continuar", icon: <KeyRound className="size-4" />, onSelect: () => setShowCode(true) },
                "separator",
                { label: "Eliminar trabajo", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDeleting(true) },
              ]}
            />
          </>
        }
      />
      <div className="-mt-3 mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        {/* One state, the same words as En vivo (it used to say "En curso" and "Abandonada" at once). */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <LiveStatusLabel status={s.liveStatus} endedByTeacher={s.endedByTeacher} />
          <span className="text-sm text-text-3">
            Empezó {fmtDateTime(s.startedAt)}
            {s.completedAt ? ` · terminó ${fmtDateTime(s.completedAt)}` : ` · última acción ${fmtRelative(s.lastSignalAt)}`}
          </span>
        </div>
        <StageProgress
          stage={s.currentStage}
          reached={s.reachedStage}
          done={s.progressSteps}
          total={s.stepsTotal}
          endedByTeacher={s.endedByTeacher}
          className="w-full max-w-xs"
        />
      </div>
      <EndWorkDialog
        open={ending}
        onOpenChange={setEnding}
        studentName={d.student.fullName}
        loading={m.end.isPending}
        onConfirm={() =>
          m.end.mutate(d.activity.id, {
            onSuccess: () => {
              setEnding(false);
              toast.success(`Terminaste el trabajo de ${d.student.fullName}`);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <DeleteWorkDialog
        open={deleting}
        onOpenChange={setDeleting}
        studentName={d.student.fullName}
        activityTitle={d.activity.title}
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(undefined, {
            onSuccess: (r) => {
              setDeleting(false);
              toast.success("Trabajo eliminado");
              // Leave first, then drop the cached work: removing it while this page is mounted refetched it (404).
              void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activityId } }).then(() =>
                qc.removeQueries({ queryKey: sessionKeys.one(d.session.id) }),
              );
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <ResumeCodeDialog open={showCode} onOpenChange={setShowCode} studentName={d.student.fullName} code={s.resumeCode} />
    </>
  );
}

function OpenAlerts({ d }: { d: SessionDetail }) {
  const qc = useQueryClient();
  const { alertStatus } = useLiveMutations(d.activity.id);
  const open = d.alerts.filter((a) => a.status === "open");
  if (!open.length) return null;
  return (
    <section aria-labelledby="session-alerts" className="mb-6 rounded-lg border border-line bg-surface p-4 shadow-1 sm:p-5">
      <h2 id="session-alerts" className="font-display text-lg font-semibold text-ink">
        {plural(open.length, "alerta abierta", "alertas abiertas")}
      </h2>
      <ul className="mt-3 space-y-3">
        {open.map((a) => (
          <AlertItem
            key={a.id}
            alert={{ ...a, sessionId: d.session.id }}
            showStudent={false}
            showConversationLink={false}
            busy={alertStatus.isPending && alertStatus.variables?.alertId === a.id}
            onStatus={(status) =>
              alertStatus.mutate(
                { alertId: a.id, status },
                {
                  onSuccess: () => {
                    void qc.invalidateQueries({ queryKey: sessionKeys.one(d.session.id) });
                    toast.success(status === "reviewed" ? "Alerta marcada como revisada" : "Alerta descartada");
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          />
        ))}
      </ul>
    </section>
  );
}

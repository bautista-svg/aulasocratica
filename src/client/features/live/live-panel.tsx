// "En vivo" tab of an activity. Shows ONLY the students who joined THIS activity (its
// learning sessions), never the whole classroom roster. Updates through Server-Sent Events
// with polling as a fallback.
import { memo, useDeferredValue, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, ChevronDown, ChevronRight, CircleStop, Download, FileText, KeyRound, ListChecks, MoreHorizontal, Play, Trash2, Users } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge, EmptyState, ErrorState, Skeleton } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Checkbox, Menu } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { errorMessage } from "@client/lib/api";
import { fmtRelative, plural } from "@client/lib/format";
import { XL_QUERY, useMediaQuery } from "@client/lib/media";
import { LIVE_STATUS_HELP, LIVE_STATUS_LABELS, formatDuration } from "@shared/domain/live-monitor";
import type { LiveParticipant, LiveSnapshot, LiveWindow } from "@shared/contracts/live";
import { liveKeys, useActivityStream, useLiveMutations, useLiveSnapshot, useNow, useThrottled } from "./api";
import { LiveStatusLabel, StageProgress } from "./bits";
import { Heatmaps } from "./heatmaps";
import { useJourneyDownload, useSessionActions } from "@client/features/sessions/api";
import { DeleteWorkDialog, EndWorkDialog, ResumeCodeDialog } from "@client/features/sessions/dialogs";

// One vocabulary (D19): "Activos" is the same rule as the "Activos ahora" card; "Sin terminar"
// are all the works still open, whatever their live state.
type Filter = "all" | "active" | "open" | "support" | "done";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "open", label: "Sin terminar" },
  { value: "support", label: "Necesitan apoyo" },
  { value: "done", label: "Terminaron" },
];

// Memoized: the activity page re-renders on every tab change; the live view only depends on the id.
export const LivePanel = memo(LivePanelView);

function LivePanelView({ activityId }: { activityId: string }) {
  const qc = useQueryClient();
  const [window, setWindow] = useState<LiveWindow>("30m");
  const q = useLiveSnapshot(activityId, window);
  const refetch = useThrottled(() => void qc.invalidateQueries({ queryKey: liveKeys.all(activityId) }), 1500);
  const { connected } = useActivityStream(activityId, () => refetch());
  const now = useNow(5_000);
  // Every refresh (polling, events) re-renders the whole view: rendering the new snapshot as a
  // deferred, interruptible update keeps clicks responsive and avoids one long blocking task.
  const snap = useDeferredValue(q.data);

  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!snap) return <LiveSkeleton />;
  const ago = Math.max(0, Math.round((now - q.dataUpdatedAt) / 1000));

  return (
    <div className="space-y-6">
      <LiveHeader snap={snap} connected={connected} ago={ago} refreshing={q.isFetching} stale={q.isError} activityId={activityId} />
      {snap.participants.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="Todavía no entró nadie"
          description={
            snap.activity.status === "published"
              ? "Todavía no entró nadie. Compartí el enlace desde la pestaña Compartir."
              : "Todavía no entró nadie. Publicá la actividad y compartí el enlace desde la pestaña Compartir."
          }
          action={
            <Link to="/app/actividades/$activityId" params={{ activityId }} search={{ tab: "compartir" }} className={buttonClass("secondary")}>
              Ir a Compartir
            </Link>
          }
        />
      ) : (
        <>
          <AlertsLink snap={snap} activityId={activityId} />
          <ParticipantsSection snap={snap} activityId={activityId} />
          <HeatmapSection snap={snap} window={window} onWindowChange={setWindow} />
          <p className="text-xs leading-5 text-text-3">
            Estado, etapa y tiempos salen de lo que registra la plataforma (respuestas, mensajes y botones), no de una evaluación. «{LIVE_STATUS_LABELS.active}»:{" "}
            {LIVE_STATUS_HELP.active.toLowerCase()} «{LIVE_STATUS_LABELS.idle}»: {LIVE_STATUS_HELP.idle.toLowerCase()} «{LIVE_STATUS_LABELS.abandoned}»:{" "}
            {LIVE_STATUS_HELP.abandoned.toLowerCase()} «{LIVE_STATUS_LABELS.completed}»: {LIVE_STATUS_HELP.completed.toLowerCase()} La etapa se numera igual
            que la ve el alumno («Paso 2 de 3»). El tiempo suma los momentos con actividad: cada pausa cuenta hasta 5 minutos.
          </p>
        </>
      )}
    </div>
  );
}

/** The alerts have their own tab: "En vivo" only says how many are open and takes you there. */
function AlertsLink({ snap, activityId }: { snap: LiveSnapshot; activityId: string }) {
  const open = snap.totals.openAlerts;
  if (!open) return null;
  return (
    <Link
      to="/app/actividades/$activityId"
      params={{ activityId }}
      search={{ tab: "alertas" }}
      className="group flex min-h-14 items-center gap-3 rounded-lg border border-rose/30 bg-rose-soft/60 px-4 py-3 text-sm transition-colors hover:border-rose/60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-rose shadow-1">
        <Bell className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 leading-5">
        <span className="font-semibold text-ink">{plural(open, "alerta abierta", "alertas abiertas")}</span>
        <span className="text-text-2"> · revisalas en la pestaña Alertas</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function LiveSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando la vista en vivo">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "leaf" | "amber" }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3 shadow-1">
      <div className="text-xs font-semibold text-text-3">{label}</div>
      <div className={cn("tabular mt-1 font-display text-3xl font-semibold", tone === "leaf" ? "text-leaf" : tone === "amber" ? "text-amber" : "text-ink")}>{value}</div>
      <div className="mt-0.5 text-xs text-text-3">{hint}</div>
    </div>
  );
}

function LiveHeader({
  snap,
  connected,
  ago,
  refreshing,
  stale,
  activityId,
}: {
  snap: LiveSnapshot;
  connected: boolean;
  ago: number;
  refreshing: boolean;
  stale: boolean;
  activityId: string;
}) {
  const t = snap.totals;
  const open = snap.participants.filter((p) => p.status === "in_progress").length;
  const linkOpen = snap.activity.status === "published" && snap.activity.linkActive;
  const [confirmAll, setConfirmAll] = useState(false);
  const [closeLink, setCloseLink] = useState(true);
  const { endAll } = useLiveMutations(activityId);
  return (
    <section aria-labelledby="live-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="live-title" className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <span className={cn("size-2.5 rounded-full", connected ? "animate-pulse-dot bg-leaf-bright" : "bg-text-3")} aria-hidden="true" />
            En vivo
          </h2>
          <p className="text-sm text-text-3" aria-live="off">
            {stale ? "No se pudo actualizar; reintentando… " : null}
            Actualizado {ago < 5 ? "recién" : ago < 60 ? `hace ${ago} s` : `hace ${Math.round(ago / 60)} min`}
            {refreshing ? " · actualizando…" : null}
            {!connected ? " · se actualiza cada 15 s" : null}
          </p>
        </div>
        {open > 0 ? (
          <Button
            variant="secondary"
            icon={<CircleStop className="size-4" />}
            onClick={() => {
              setCloseLink(true);
              setConfirmAll(true);
            }}
          >
            Terminar para todos
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Entraron" value={t.joined} hint="a esta actividad" />
        <StatCard label="Activos ahora" value={t.activeNow} hint="hicieron algo en los últimos 2 min" tone={t.activeNow ? "leaf" : undefined} />
        <StatCard label="Terminaron" value={t.completed} hint={`de ${t.joined}`} />
        <StatCard label="Necesitan apoyo" value={t.needSupport} hint="alertas abiertas, muchas pistas o sin arrancar" tone={t.needSupport ? "amber" : undefined} />
      </div>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="¿Terminar el trabajo de todos?"
        description={
          <>
            <p>
              Se termina el trabajo de {plural(open, "alumno que todavía no terminó", "alumnos que todavía no terminaron")}. Se guarda lo que hicieron
              hasta ahora y ya no pueden seguir escribiendo. Desde el trabajo de cada uno podés permitirle continuar.
            </p>
            {linkOpen ? (
              <div className="pt-1">
                <Checkbox
                  checked={closeLink}
                  onCheckedChange={setCloseLink}
                  label="Cerrar también el enlace"
                  description={
                    closeLink
                      ? "Nadie más puede entrar a la actividad. La volvés a abrir desde Compartir con «Aceptar alumnos»."
                      : "El enlace sigue abierto: si alguien entra ahora (también un alumno nuevo), empieza a trabajar."
                  }
                />
              </div>
            ) : (
              <p>El enlace ya está cerrado: nadie más puede entrar.</p>
            )}
          </>
        }
        confirmLabel={linkOpen && closeLink ? "Terminar y cerrar el enlace" : "Terminar para todos"}
        variant="primary"
        loading={endAll.isPending}
        onConfirm={() =>
          endAll.mutate(
            { closeLink: linkOpen && closeLink },
            {
              onSuccess: (r) => {
                setConfirmAll(false);
                const who = r.ended ? `Terminaste el trabajo de ${plural(r.ended, "alumno", "alumnos")}` : "No había trabajos sin terminar";
                toast.success(r.linkClosed ? `${who}. El enlace quedó cerrado.` : `${who}.`);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </section>
  );
}

function matches(p: LiveParticipant, f: Filter) {
  if (f === "active") return p.liveStatus === "active";
  if (f === "open") return p.status === "in_progress";
  if (f === "support") return p.needsSupport;
  if (f === "done") return p.status === "completed";
  return true;
}

const HELP_WORDS = {
  hint_requested: ["pista", "pistas"],
  clarification_requested: ["vez «no entendí»", "veces «no entendí»"],
  example_requested: ["ejemplo", "ejemplos"],
} as const;

function helpSummary(p: LiveParticipant): string {
  const parts = (Object.keys(HELP_WORDS) as (keyof typeof HELP_WORDS)[])
    .filter((t) => p.helpCounts[t] > 0)
    .map((t) => plural(p.helpCounts[t], HELP_WORDS[t][0], HELP_WORDS[t][1]));
  return parts.length ? parts.join(" · ") : "Sin pedidos";
}

function Stage({ p, className }: { p: LiveParticipant; className?: string }) {
  return (
    <StageProgress
      stage={p.currentStage}
      reached={p.reachedStage}
      done={p.progressSteps}
      total={p.stepsTotal}
      endedByTeacher={p.endedByTeacher}
      className={className}
    />
  );
}

function ParticipantsSection({ snap, activityId }: { snap: LiveSnapshot; activityId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, snap.participants.filter((p) => matches(p, f.value)).length])), [snap]);
  const list = snap.participants.filter((p) => matches(p, filter));
  const actions = useRowActions(activityId, snap.activity.title);
  // Only the layout that fits is rendered (less work per update). Cards up to 1279 px: at 1024 px
  // the table did not fit next to the sidebar (D13).
  const wide = useMediaQuery(XL_QUERY);
  return (
    <section aria-labelledby="participants-title">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 id="participants-title" className="font-display text-lg font-semibold text-ink">
          Quién hizo esta actividad
        </h3>
        <div role="group" aria-label="Filtrar alumnos" className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                filter === f.value ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40",
              )}
            >
              {f.label}
              <span className="tabular text-xs">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-2">Nadie en este grupo por ahora.</p>
      ) : !wide ? (
        <>
          {/* Phones, tablets and small laptops: cards. */}
          <ul className="grid gap-3 md:grid-cols-2">
            {list.map((p) => (
              <li key={p.sessionId} className="flex flex-col rounded-lg border border-line bg-surface p-4 shadow-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/app/sesiones/$sessionId" params={{ sessionId: p.sessionId }} className="block truncate text-[16px] font-semibold text-ink underline-offset-4 hover:underline">
                      {p.studentName}
                    </Link>
                    <RosterMark p={p} />
                    <LiveStatusLabel status={p.liveStatus} endedByTeacher={p.endedByTeacher} className="mt-1" />
                    {p.liveStatus !== "active" && p.status !== "completed" ? (
                      <p className="mt-0.5 text-xs text-text-3">Última acción {fmtRelative(p.lastSignalAt)}</p>
                    ) : null}
                  </div>
                  <RowMenu p={p} actions={actions} />
                </div>
                <Stage p={p} className="mt-3" />
                {p.lastTutorQuestion && p.status !== "completed" ? (
                  <p className="q-hang mt-3 line-clamp-2 text-sm">{p.lastTutorQuestion}</p>
                ) : null}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-text-3">Tiempo</dt>
                    <dd className="tabular font-medium text-text">{formatDuration(p.workMs)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-3">Pedidos de ayuda</dt>
                    <dd className="tabular font-medium text-text">{p.helpRequests}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-3">Alertas</dt>
                    <dd>
                      <AlertCount p={p} />
                    </dd>
                  </div>
                </dl>
                {p.supportReasons.length ? <p className="mt-2 text-sm font-medium text-amber">{p.supportReasons.join(" · ")}</p> : null}
                <div className="mt-auto flex gap-2 pt-3">
                  <Link to="/app/sesiones/$sessionId" params={{ sessionId: p.sessionId }} className={buttonClass("secondary", "md", "flex-1")}>
                    <FileText className="size-4" aria-hidden="true" />
                    Ver trabajo
                  </Link>
                  <PdfButton p={p} actions={actions} />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {/* Wide screens: table. It scrolls inside its own box if a long name makes it wider than the page. */}
          <div className="relative overflow-x-auto rounded-lg border border-line bg-surface shadow-1">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Alumnos que entraron a esta actividad</caption>
              <thead className="bg-paper text-left text-xs font-semibold text-text-2">
                <tr>
                  <th scope="col" className="px-4 py-2.5">
                    Alumno
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Estado
                  </th>
                  <th scope="col" className="w-56 px-3 py-2.5">
                    Etapa
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Tiempo
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Pedidos de ayuda
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Alertas
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.sessionId} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <Link to="/app/sesiones/$sessionId" params={{ sessionId: p.sessionId }} className="font-semibold text-ink underline-offset-4 hover:underline">
                        {p.studentName}
                      </Link>
                      <RosterMark p={p} />
                      {p.supportReasons.length ? <p className="mt-0.5 text-xs font-medium text-amber">{p.supportReasons.join(" · ")}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <LiveStatusLabel status={p.liveStatus} endedByTeacher={p.endedByTeacher} />
                      {p.liveStatus !== "active" && p.status !== "completed" ? <p className="mt-0.5 text-xs text-text-3">Última acción {fmtRelative(p.lastSignalAt)}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <Stage p={p} />
                      {p.lastTutorQuestion && p.status !== "completed" ? (
                        <p className="mt-1.5 line-clamp-1 text-xs text-text-3" title={p.lastTutorQuestion}>
                          Tutor: {p.lastTutorQuestion}
                        </p>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-3 whitespace-nowrap text-text">{formatDuration(p.workMs)}</td>
                    <td className="px-3 py-3">
                      <span className="tabular font-semibold text-text">{p.helpRequests}</span>
                      <p className="text-xs text-text-3">{helpSummary(p)}</p>
                    </td>
                    <td className="px-3 py-3">
                      <AlertCount p={p} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <Link to="/app/sesiones/$sessionId" params={{ sessionId: p.sessionId }} className={buttonClass("secondary", "sm")}>
                          Ver trabajo
                        </Link>
                        <PdfButton p={p} actions={actions} compact />
                        <RowMenu p={p} actions={actions} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <RowDialogs actions={actions} />
    </section>
  );
}

/** The journey PDF is always one tap away (it used to hide in the "⋯" menu on desktop). */
function PdfButton({ p, actions, compact }: { p: LiveParticipant; actions: RowActions; compact?: boolean }) {
  return (
    <Button
      variant="ghost"
      size={compact ? "sm" : "md"}
      icon={<Download className="size-4" />}
      loading={actions.pdf.busyId === p.sessionId}
      aria-label={`PDF del recorrido de ${p.studentName}`}
      onClick={() => void actions.pdf.download(p.sessionId)}
    >
      PDF
    </Button>
  );
}

/**
 * F-07: the student typed a name that was already on the classroom list (instead of continuing with
 * their code). Almost always it is that student; if not, "Eliminar trabajo" removes what was done.
 */
function RosterMark({ p }: { p: LiveParticipant }) {
  if (!p.enteredWithRosterName) return null;
  return (
    <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-2" title="Si no fue ese alumno, podés eliminar este trabajo desde «⋯».">
      <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
      Entró con un nombre de la lista del aula
    </p>
  );
}

function AlertCount({ p }: { p: LiveParticipant }) {
  if (!p.openAlerts) return <span className="text-sm text-text-3">—</span>;
  return (
    <Badge tone={p.immediateAlerts ? "rose" : "amber"}>
      <Bell className="size-3" aria-hidden="true" />
      {p.openAlerts}
      <span className="sr-only">{p.openAlerts === 1 ? " alerta abierta" : " alertas abiertas"}</span>
    </Badge>
  );
}

type RowActions = ReturnType<typeof useRowActions>;

function useRowActions(activityId: string, activityTitle: string) {
  const pdf = useJourneyDownload();
  const { end, reopen, remove } = useSessionActions(activityId);
  const [ending, setEnding] = useState<LiveParticipant | null>(null);
  const [showingCode, setShowingCode] = useState<LiveParticipant | null>(null);
  const [deleting, setDeleting] = useState<LiveParticipant | null>(null);
  return { activityTitle, pdf, end, reopen, remove, ending, setEnding, showingCode, setShowingCode, deleting, setDeleting };
}

function RowMenu({ p, actions }: { p: LiveParticipant; actions: RowActions }) {
  return (
    <Menu
      trigger={
        <Button variant="ghost" size="icon" aria-label={`Más acciones para ${p.studentName}`} className="size-11 shrink-0">
          <MoreHorizontal className="size-5" />
        </Button>
      }
      items={[
        { label: "Descargar PDF del recorrido", icon: <Download className="size-4" />, onSelect: () => void actions.pdf.download(p.sessionId) },
        { label: "Mostrar código para continuar", icon: <KeyRound className="size-4" />, onSelect: () => actions.setShowingCode(p) },
        "separator",
        p.status === "in_progress"
          ? { label: "Terminar su trabajo", icon: <CircleStop className="size-4" />, onSelect: () => actions.setEnding(p) }
          : {
              label: "Permitir continuar",
              icon: <Play className="size-4" />,
              onSelect: () =>
                actions.reopen.mutate(p.sessionId, {
                  onSuccess: () => toast.success(`${p.studentName} puede continuar su trabajo`),
                  onError: (e) => toast.error(errorMessage(e)),
                }),
            },
        { label: "Eliminar trabajo", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => actions.setDeleting(p) },
      ]}
    />
  );
}

function RowDialogs({ actions }: { actions: RowActions }) {
  const { ending, setEnding, showingCode, setShowingCode, end, deleting, setDeleting, remove } = actions;
  return (
    <>
      <EndWorkDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        studentName={ending?.studentName ?? ""}
        loading={end.isPending}
        onConfirm={() =>
          ending &&
          end.mutate(ending.sessionId, {
            onSuccess: () => {
              toast.success(`Terminaste el trabajo de ${ending.studentName}`);
              setEnding(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <ResumeCodeDialog
        open={!!showingCode}
        onOpenChange={(o) => !o && setShowingCode(null)}
        studentName={showingCode?.studentName ?? ""}
        code={showingCode?.resumeCode ?? ""}
      />
      <DeleteWorkDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        studentName={deleting?.studentName ?? ""}
        activityTitle={actions.activityTitle}
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.sessionId, {
            onSuccess: () => {
              toast.success(`Eliminaste el trabajo de ${deleting.studentName}`);
              setDeleting(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}

// Memoized: it only depends on the snapshot and the period, not on the 5 s clock of the panel.
const HeatmapSection = memo(HeatmapSectionView);

function HeatmapSectionView({ snap, window, onWindowChange }: { snap: LiveSnapshot; window: LiveWindow; onWindowChange: (w: LiveWindow) => void }) {
  const [open, setOpen] = useState(() => typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(min-width: 768px)").matches);
  return (
    <section aria-labelledby="heat-title" className="rounded-lg border border-line bg-surface shadow-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="heat-body"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left sm:px-5"
      >
        <span>
          <span id="heat-title" className="block font-display text-lg font-semibold text-ink">
            Mapas de calor
          </span>
          <span className="block text-sm text-text-2">Ayudas, actividad en el tiempo y tiempo por etapa de cada alumno.</span>
        </span>
        <ChevronDown className={cn("size-5 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id="heat-body" hidden={!open} className="border-t border-line px-4 pt-4 pb-5 sm:px-5">
        {open ? <Heatmaps snapshot={snap} window={window} onWindowChange={onWindowChange} /> : null}
      </div>
    </section>
  );
}

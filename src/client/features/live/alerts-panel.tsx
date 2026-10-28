// "Alertas" tab of an activity: the alerts of the students who joined it, to review, dismiss or
// reopen. Same snapshot and Server-Sent Events as "En vivo", so both stay in step.
import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CheckCheck, ChevronDown, Radio } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge, EmptyState, ErrorState, Skeleton } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import type { LiveSnapshot, LiveWindow } from "@shared/contracts/live";
import { liveKeys, useActivityStream, useLiveMutations, useLiveSnapshot, useThrottled } from "./api";
import { AlertItem } from "./bits";

/** The default period of "En vivo": alerts do not depend on it, and both tabs share one snapshot. */
const ALERTS_WINDOW: LiveWindow = "30m";

/**
 * Open alerts of the activity once its live data is loading (`enabled`), for the tab badge, and a
 * toast for each new immediate-attention alert whose action opens the "Alertas" tab.
 */
export function useActivityAlerts(activityId: string, enabled: boolean, onOpen: () => void): number | undefined {
  const q = useLiveSnapshot(activityId, ALERTS_WINDOW, enabled);
  useImmediateAlertToasts(q.data, onOpen);
  return q.data?.totals.openAlerts;
}

/** A toast when a new immediate-attention alert arrives (not for the ones already there on load). */
function useImmediateAlertToasts(snap: LiveSnapshot | undefined, onOpen: () => void) {
  const seen = useRef<Set<string> | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    if (!snap) return;
    const immediate = snap.alerts.filter((a) => a.status === "open" && a.severity === "immediate");
    if (seen.current === null) {
      seen.current = new Set(snap.alerts.map((a) => a.id));
      return;
    }
    for (const a of immediate) {
      if (!seen.current.has(a.id)) {
        toast.error(`Atención inmediata: ${a.studentName} · ${a.name}`, {
          duration: 15_000,
          action: { label: "Ver alertas", onClick: () => open.current() },
        });
      }
    }
    for (const a of snap.alerts) seen.current.add(a.id);
  }, [snap]);
}

// Memoized: the activity page re-renders on every tab change; this view only depends on the id.
export const AlertsPanel = memo(AlertsPanelView);

function AlertsPanelView({ activityId }: { activityId: string }) {
  const qc = useQueryClient();
  const q = useLiveSnapshot(activityId, ALERTS_WINDOW);
  const refetch = useThrottled(() => void qc.invalidateQueries({ queryKey: liveKeys.all(activityId) }), 1500);
  const { connected } = useActivityStream(activityId, () => refetch());
  const snap = useDeferredValue(q.data);

  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!snap) return <AlertsSkeleton />;
  return <AlertsView snap={snap} activityId={activityId} connected={connected} stale={q.isError} />;
}

function AlertsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando las alertas">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-full max-w-xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}

function AlertsView({ snap, activityId, connected, stale }: { snap: LiveSnapshot; activityId: string; connected: boolean; stale: boolean }) {
  const open = snap.alerts.filter((a) => a.status === "open");
  const closed = snap.alerts.filter((a) => a.status !== "open");
  const [showClosed, setShowClosed] = useState(false);
  const { alertStatus } = useLiveMutations(activityId);
  const busy = (id: string) => alertStatus.isPending && alertStatus.variables?.alertId === id;

  return (
    <div className="space-y-5">
      <section aria-labelledby="alerts-title">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 id="alerts-title" className="flex items-center gap-2 font-display text-xl font-semibold text-ink">
            <span className={cn("size-2.5 rounded-full", connected ? "animate-pulse-dot bg-leaf-bright" : "bg-text-3")} aria-hidden="true" />
            Alertas
          </h2>
          {open.length ? (
            <Badge tone="rose">{plural(open.length, "abierta", "abiertas")}</Badge>
          ) : closed.length ? (
            <Badge tone="leaf">Todas revisadas</Badge>
          ) : null}
          {stale || !connected ? (
            <span className="text-sm text-text-3">{stale ? "No se pudo actualizar; reintentando…" : "Se actualizan cada 15 s"}</span>
          ) : null}
        </div>
        {snap.alerts.length ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-text-2">
            «Observada» = la registró el navegador (pegó texto, salió de la actividad). «Detectada por IA» = lectura de la IA sobre lo que escribió. Revisá
            la conversación antes de actuar.
          </p>
        ) : null}
      </section>

      {snap.alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-8" />}
          title="No hay alertas"
          description={
            snap.participants.length === 0
              ? "Cuando tus alumnos trabajen, acá vas a ver si alguno pega texto copiado, sale de la actividad, se traba o escribe algo preocupante."
              : "Ningún alumno tuvo alertas por ahora. Si alguno pega texto copiado, sale de la actividad, se traba o escribe algo preocupante, lo vas a ver acá."
          }
          action={
            <Link to="/app/actividades/$activityId" params={{ activityId }} search={{ tab: "en-vivo" }} className={buttonClass("secondary")}>
              <Radio className="size-4" aria-hidden="true" />
              Ver En vivo
            </Link>
          }
        />
      ) : (
        <>
          {open.length ? (
            <ul className="space-y-3" aria-live="polite" aria-label="Alertas abiertas">
              {open.map((a) => (
                <AlertItem
                  key={a.id}
                  alert={a}
                  busy={busy(a.id)}
                  onStatus={(status) =>
                    alertStatus.mutate(
                      { alertId: a.id, status },
                      {
                        onSuccess: () => toast.success(status === "reviewed" ? "Alerta marcada como revisada" : "Alerta descartada"),
                        onError: (e) => toast.error(errorMessage(e)),
                      },
                    )
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2.5 rounded-lg bg-leaf-soft px-4 py-3.5 text-sm font-semibold text-leaf" aria-live="polite">
              <CheckCheck className="size-5 shrink-0" aria-hidden="true" />
              No quedan alertas por revisar.
            </p>
          )}
          {closed.length ? (
            <section aria-label="Alertas revisadas o descartadas" className="border-t border-line pt-4">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showClosed}
                icon={<ChevronDown className={cn("size-4 transition-transform", showClosed && "rotate-180")} />}
                onClick={() => setShowClosed((v) => !v)}
              >
                {showClosed ? "Ocultar las revisadas" : `Ver las revisadas o descartadas (${closed.length})`}
              </Button>
              {showClosed ? (
                <ul className="mt-3 space-y-3">
                  {closed.map((a) => (
                    <AlertItem
                      key={a.id}
                      alert={a}
                      busy={busy(a.id)}
                      onStatus={(status) =>
                        alertStatus.mutate({ alertId: a.id, status }, { onSuccess: () => toast.success("Alerta reabierta"), onError: (e) => toast.error(errorMessage(e)) })
                      }
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

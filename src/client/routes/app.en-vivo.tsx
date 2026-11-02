import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, Sparkles } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { ButtonLink } from "@client/components/ui/button";
import { plural } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { useAllActivities, useDashboard } from "@client/features/dashboard/api";
import { activityState } from "@shared/domain/activity-state";

export const Route = createFileRoute("/app/en-vivo")({
  component: LivePage,
});

/** "En clase": the classes happening now, then the open activities nobody is working on. */
function LivePage() {
  usePageTitle("En vivo");
  const dash = useDashboard();
  const all = useAllActivities();
  const live = dash.data?.live ?? [];
  const liveIds = new Set(live.map((a) => a.id));
  const openIdle = (all.data?.activities ?? []).filter((a) => activityState(a).open && !liveIds.has(a.id));

  return (
    <>
      <PageHeader
        eyebrow="En clase"
        title="En vivo"
        description="Las actividades con alumnos trabajando ahora. Entrá a una para ver quién avanza, quién se trabó y quién pide ayuda."
      />
      {dash.isPending ? (
        <SkeletonList rows={2} />
      ) : dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
      ) : (
        <div className="grid gap-8">
          {live.length === 0 ? (
            <EmptyState
              level={2}
              icon={<Radio className="size-8" />}
              title="Nadie está trabajando en este momento"
              description="Cuando un alumno entre a una actividad abierta, la vas a ver acá. La página se actualiza sola."
              action={
                openIdle.length === 0 ? (
                  <ButtonLink to="/app/actividades" icon={<Sparkles className="size-4" />}>
                    Ir a Actividades
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {live.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/app/actividades/$activityId"
                    params={{ activityId: a.id }}
                    search={{ tab: "en-vivo" }}
                    className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 shadow-1 transition-[border-color,box-shadow] hover:border-leaf/50 hover:shadow-2"
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-leaf">
                      <span className="live-dot" aria-hidden="true" />
                      {plural(a.activeNow, "alumno trabajando", "alumnos trabajando")}
                    </span>
                    <span className="mt-2 text-[16px] leading-snug font-semibold tracking-[-0.02em] break-words text-ink">{a.title}</span>
                    <span className="mt-0.5 text-[13px] text-text-2">{a.classroomName}</span>
                    <span className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-[12.5px] text-text-3">
                      <span className="tabular">
                        {plural(a.participants, "participante", "participantes")} · {a.completed} {a.completed === 1 ? "terminó" : "terminaron"}
                      </span>
                      {a.openAlerts > 0 ? <Badge tone="rose">{plural(a.openAlerts, "aviso", "avisos")}</Badge> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {openIdle.length > 0 ? (
            <section aria-labelledby="abiertas">
              <h2 id="abiertas" className="mb-2 text-[14px] font-semibold text-ink">
                Abiertas, sin alumnos ahora
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-1">
                {openIdle.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/app/actividades/$activityId"
                      params={{ activityId: a.id }}
                      search={{ tab: "compartir" }}
                      className="flex min-h-13 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">{a.title}</span>
                        <span className="block truncate text-[12.5px] text-text-3">{a.classroomName}</span>
                      </span>
                      <span className="text-[13px] font-medium text-lilac-ink">Compartir el enlace</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

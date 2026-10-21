import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BellRing, CheckCheck } from "lucide-react";
import { optionalEnum, optionalUuid, searchParams } from "@client/lib/search";
import { EmptyState, ErrorState, Notice, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { Field, Select } from "@client/components/ui/field";
import { api, errorMessage } from "@client/lib/api";
import { plural } from "@client/lib/format";
import { cn } from "@client/lib/cn";
import { usePageTitle } from "@client/lib/page-title";
import { classroomKeys, useClassrooms } from "@client/features/classrooms/api";
import { ALERTS_POLL_MS, useAlertInbox, useAlertMutations, type AlertFilters } from "@client/features/alerts/api";
import { AlertItem } from "@client/features/live/bits";
import type { ActivitySummary } from "@shared/contracts/activities";
import type { AlertInboxCounts } from "@shared/contracts/alerts";

const ESTADOS = ["abiertas", "revisadas", "descartadas", "todas"] as const;
type Estado = (typeof ESTADOS)[number];
const STATUS: Record<Estado, AlertFilters["status"]> = { abiertas: "open", revisadas: "reviewed", descartadas: "dismissed", todas: "all" };

export const Route = createFileRoute("/app/alertas")({
  validateSearch: searchParams({
    estado: optionalEnum(ESTADOS),
    aula: optionalUuid,
    actividad: optionalUuid,
    gravedad: optionalEnum(["inmediata", "revisar"] as const),
    origen: optionalEnum(["ia", "observada"] as const),
  }),
  component: AlertsPage,
});

function useActivitiesOf(classroomId: string | undefined) {
  return useQuery({
    queryKey: classroomKeys.activities(classroomId ?? "none"),
    queryFn: ({ signal }) => api.get<{ activities: ActivitySummary[] }>(`/api/classrooms/${classroomId}/activities`, signal),
    select: (d) => d.activities,
    enabled: Boolean(classroomId),
  });
}

function AlertsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  usePageTitle("Alertas");
  const estado: Estado = search.estado ?? "abiertas";
  const filters: AlertFilters = {
    status: STATUS[estado],
    classroomId: search.aula,
    activityId: search.actividad,
    severity: search.gravedad === "inmediata" ? "immediate" : search.gravedad === "revisar" ? "review" : undefined,
    origin: search.origen === "ia" ? "ai" : search.origen === "observada" ? "observed" : undefined,
  };
  const inbox = useAlertInbox(filters);
  const { setStatus, bulk } = useAlertMutations();
  const classrooms = useClassrooms(false);
  const archivedRooms = useClassrooms(true);
  const activities = useActivitiesOf(search.aula);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = inbox.data?.pages[0]?.counts;
  const filtered = Boolean(search.aula || search.actividad || search.gravedad || search.origen);
  const openShown = items.filter((a) => a.status === "open");

  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true });

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Las alertas de todos tus alumnos, de todas tus aulas y actividades. Las detectadas por IA son interpretaciones de lo que escribieron: mirá la conversación antes de actuar."
      />

      <StatusFilter value={estado} counts={counts} onChange={(v) => setSearch({ estado: v === "abiertas" ? undefined : v })} />

      <div className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-3 shadow-1 sm:p-4 lg:grid-cols-4">
        <Field label="Aula">
          {({ id }) => (
            <Select id={id} value={search.aula ?? ""} onChange={(e) => setSearch({ aula: e.target.value || undefined, actividad: undefined })}>
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
        <Field label="Actividad" hint={!search.aula ? "Primero elegí un aula." : undefined}>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={search.actividad ?? ""}
              disabled={!search.aula || activities.isPending}
              onChange={(e) => setSearch({ actividad: e.target.value || undefined })}
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
        <Field label="Gravedad">
          {({ id }) => (
            <Select id={id} value={search.gravedad ?? ""} onChange={(e) => setSearch({ gravedad: (e.target.value || undefined) as typeof search.gravedad })}>
              <option value="">Todas</option>
              <option value="inmediata">Atención inmediata</option>
              <option value="revisar">Revisar pronto</option>
            </Select>
          )}
        </Field>
        <Field label="Origen">
          {({ id }) => (
            <Select id={id} value={search.origen ?? ""} onChange={(e) => setSearch({ origen: (e.target.value || undefined) as typeof search.origen })}>
              <option value="">Todas</option>
              <option value="ia">Detectadas por IA</option>
              <option value="observada">Observadas (pegó texto, salió)</option>
            </Select>
          )}
        </Field>
      </div>

      {estado === "abiertas" && counts && counts.immediate > 0 && !search.gravedad ? (
        <Notice tone="rose" className="mb-4" title={`${plural(counts.immediate, "alerta necesita", "alertas necesitan")} atención inmediata`}>
          Están primeras en la lista.
        </Notice>
      ) : null}

      {inbox.isPending ? (
        <SkeletonList rows={4} />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          level={2}
          icon={<BellRing className="size-8" />}
          title={filtered ? "No hay alertas con estos filtros" : estado === "abiertas" ? "No hay alertas abiertas" : "No hay alertas acá"}
          description={
            filtered
              ? "Probá con otra aula, otra actividad u otro filtro."
              : "Cuando el tutor detecte algo que conviene mirar, o un alumno pegue texto de afuera o salga de la actividad, aparece acá."
          }
        />
      ) : (
        <>
          {estado === "abiertas" && openShown.length > 1 ? (
            <div className="mb-3 flex justify-end">
              <Button variant="secondary" size="sm" icon={<CheckCheck className="size-4" />} onClick={() => setConfirmBulk(true)}>
                Marcar como revisadas las {openShown.length} que ves
              </Button>
            </div>
          ) : null}
          <h2 id="lista-alertas" tabIndex={-1} className="sr-only">
            Lista de alertas
          </h2>
          <ul className="space-y-2.5">
            {items.map((a) => (
              <AlertItem
                key={a.id}
                alert={a}
                busy={setStatus.isPending && setStatus.variables?.id === a.id}
                context={
                  <>
                    <Link
                      to="/app/actividades/$activityId"
                      params={{ activityId: a.activityId }}
                      search={{ tab: "en-vivo" }}
                      className="font-semibold text-ink underline decoration-ink/35 underline-offset-4 hover:decoration-ink"
                    >
                      {a.activityTitle}
                    </Link>
                    <span className="text-text-3"> · </span>
                    {a.classroomLabel}
                  </>
                }
                onStatus={(status) =>
                  setStatus.mutate(
                    { id: a.id, status },
                    {
                      onSuccess: () => {
                        toast.success(status === "reviewed" ? "Alerta marcada como revisada" : status === "dismissed" ? "Alerta descartada" : "Alerta reabierta");
                        // The alert leaves this list: keep the keyboard focus on the list instead of losing it.
                        document.getElementById("lista-alertas")?.focus();
                      },
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  )
                }
              />
            ))}
          </ul>
          <div className="mt-4 flex flex-col items-center gap-2">
            {inbox.hasNextPage ? (
              <Button variant="secondary" loading={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
                Ver más alertas
              </Button>
            ) : null}
            {inbox.isFetchNextPageError ? <p className="text-sm text-rose">No se pudieron cargar más. Probá de nuevo.</p> : null}
            <p className="text-sm text-text-3">La lista se actualiza sola cada {ALERTS_POLL_MS / 1000} segundos.</p>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`¿Marcar ${plural(openShown.length, "alerta", "alertas")} como revisadas?`}
        description="Pasan a la pestaña Revisadas. Si te equivocás, las podés reabrir desde ahí."
        confirmLabel="Marcar como revisadas"
        variant="primary"
        loading={bulk.isPending}
        onConfirm={() =>
          bulk.mutate(
            { ids: openShown.map((a) => a.id), status: "reviewed" },
            {
              onSuccess: (r) => {
                toast.success(`${plural(r.updated, "alerta marcada", "alertas marcadas")} como revisadas`);
                setConfirmBulk(false);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </>
  );
}

function StatusFilter({ value, counts, onChange }: { value: Estado; counts: AlertInboxCounts | undefined; onChange: (v: Estado) => void }) {
  const options: { v: Estado; label: string; n?: number }[] = [
    { v: "abiertas", label: "Abiertas", n: counts?.open },
    { v: "revisadas", label: "Revisadas", n: counts?.reviewed },
    { v: "descartadas", label: "Descartadas", n: counts?.dismissed },
    { v: "todas", label: "Todas" },
  ];
  return (
    <div role="group" aria-label="Estado de las alertas" className="mb-4 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition-colors",
              on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40 hover:text-ink",
            )}
          >
            {o.label}
            {o.n !== undefined ? <span className={cn("tabular text-sm", on ? "text-white/85" : "text-text-3")}>{o.n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

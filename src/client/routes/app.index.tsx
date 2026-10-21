import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Bell, ChevronRight, LayoutList, Plus, Radio, Sparkles, X } from "lucide-react";
import { Badge, Card, EmptyState, ErrorState, Notice, PageHeader, Skeleton, Stat } from "@client/components/ui/misc";
import { Button, ButtonLink, buttonClass } from "@client/components/ui/button";
import { fmtRelative, plural } from "@client/lib/format";
import { cn } from "@client/lib/cn";
import { useMe } from "@client/lib/session";
import { useDashboard } from "@client/features/dashboard/api";
import { OnboardingChecklist } from "@client/features/dashboard/onboarding";
import { WorkspaceNameForm } from "@client/features/account/workspace-name-form";
import { usePageTitle } from "@client/features/account/page-title";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";
import { activityState } from "@shared/domain/activity-state";
import { ALERT_SEVERITY_LABELS } from "@shared/domain/alerts";
import type { DashboardResponse } from "@shared/contracts/dashboard";

export const Route = createFileRoute("/app/")({
  component: HomePage,
});

const NAME_PROMPT_KEY = "aula:name-prompt-dismissed";

function readDismissed() {
  try {
    return sessionStorage.getItem(NAME_PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

function HomePage() {
  usePageTitle("Inicio");
  const me = useMe();
  const q = useDashboard();
  const [newRoom, setNewRoom] = useState(false);
  const [nameDismissed, setNameDismissed] = useState(readDismissed);
  const navigate = useNavigate();
  const teacher = me.data?.teacher;
  const name = teacher?.displayName?.trim() ?? "";

  const prompts = (
    <>
      {teacher && !name && !nameDismissed ? (
        <Card className="relative mb-5 px-5 pt-4 pb-1">
          <button
            type="button"
            onClick={() => {
              setNameDismissed(true);
              try {
                sessionStorage.setItem(NAME_PROMPT_KEY, "1");
              } catch {
                /* private mode: just hide it for now */
              }
            }}
            aria-label="Ahora no"
            className="absolute top-2 right-2 flex size-10 items-center justify-center rounded-md text-text-3 hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
          <div className="pr-8">
            <WorkspaceNameForm current="" compact />
          </div>
        </Card>
      ) : null}

      {teacher && !teacher.hasAccount ? (
        <Notice
          tone="lilac"
          className="mb-5"
          title="Tu espacio está guardado solo en este dispositivo"
          action={
            <Link to="/app/cuenta" className={buttonClass("secondary", "sm")}>
              Ir a Mi espacio
            </Link>
          }
        >
          Si borrás los datos del navegador o cambiás de dispositivo, no vas a poder volver a entrar. Con una cuenta lo abrís desde cualquier lado.
        </Notice>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Inicio"
        title={name ? `Hola, ${name}` : "Hola"}
        description="Lo que está pasando en tus aulas y lo que conviene revisar."
        actions={
          <>
            <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setNewRoom(true)}>
              Nueva aula
            </Button>
            <ButtonLink to="/app/crear" icon={<Sparkles className="size-4" />}>
              Crear con IA
            </ButtonLink>
          </>
        }
      />

      {q.isPending ? (
        <>
          {prompts}
          <DashboardSkeleton />
        </>
      ) : q.isError ? (
        <>
          {prompts}
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </>
      ) : (
        <DashboardBody d={q.data} prompts={prompts} onNewRoom={() => setNewRoom(true)} />
      )}

      <ClassroomFormDialog
        open={newRoom}
        onOpenChange={setNewRoom}
        onSaved={(c) => void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: c.id } })}
      />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Cargando">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-surface px-4 py-3">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-3 h-6 w-1/3" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-surface p-5">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-4 h-4 w-4/5" />
        <Skeleton className="mt-3 h-4 w-3/5" />
      </div>
    </div>
  );
}

function DashboardBody({ d, prompts, onNewRoom }: { d: DashboardResponse; prompts: ReactNode; onNewRoom: () => void }) {
  // A brand-new workspace has nothing to count yet: the first steps come first.
  if (!d.onboarding.hasClassroom) {
    return (
      <div className="grid gap-5">
        <OnboardingChecklist o={d.onboarding} />
        <div>{prompts}</div>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      {!d.onboarding.done ? <OnboardingChecklist o={d.onboarding} /> : null}
      {prompts ? <div className="-mb-5 empty:hidden">{prompts}</div> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aulas" value={d.counts.classrooms} />
        <Stat label="Actividades" value={d.counts.activities} hint={`${d.counts.published} publicadas`} />
        <Stat label="Alumnos" value={d.counts.students} hint="En tus aulas activas" />
        <Stat label="Alertas por revisar" value={d.counts.openAlerts} />
      </div>

      {d.counts.published > 0 || d.live.length > 0 ? <LiveNow d={d} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <AlertsToReview d={d} />
        <RecentActivities d={d} onNewRoom={onNewRoom} />
      </div>
    </div>
  );
}

function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-display text-xl font-semibold text-ink">{children}</h2>
      {extra}
    </div>
  );
}

function LiveNow({ d }: { d: DashboardResponse }) {
  return (
    <section aria-labelledby="en-clase">
      <SectionTitle extra={<span className="text-sm text-text-3">Alumnos con actividad en los últimos 2 minutos</span>}>
        <span id="en-clase">Ahora en clase</span>
      </SectionTitle>
      {d.live.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface/60 px-5 py-4 text-sm text-text-2">
          Nadie está trabajando en este momento. Cuando un alumno esté en una actividad abierta, la vas a ver acá.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.live.map((a) => (
            <li key={a.id}>
              <Link
                to="/app/actividades/$activityId"
                params={{ activityId: a.id }}
                search={{ tab: "en-vivo" }}
                className="group flex h-full flex-col rounded-lg border border-leaf/30 bg-surface p-5 shadow-1 transition-[border-color,box-shadow] hover:border-leaf/60 hover:shadow-2"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-leaf">
                  <span className="size-2 animate-pulse-dot rounded-full bg-leaf" aria-hidden="true" />
                  {plural(a.activeNow, "alumno trabajando", "alumnos trabajando")}
                </span>
                <span className="mt-2 font-display text-lg leading-snug font-semibold text-ink group-hover:underline group-hover:decoration-lilac group-hover:underline-offset-4">
                  {a.title}
                </span>
                <span className="mt-0.5 text-sm text-text-2">{a.classroomName}</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-sm text-text-3">
                  <span className="tabular">
                    {plural(a.participants, "participante", "participantes")} · {a.completed} terminaron
                  </span>
                  {a.openAlerts > 0 ? (
                    <Badge tone="rose">
                      <Bell className="size-3" aria-hidden="true" />
                      {plural(a.openAlerts, "alerta", "alertas")}
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Radio className="size-4" aria-hidden="true" /> Ver en vivo
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AlertsToReview({ d }: { d: DashboardResponse }) {
  return (
    <section aria-labelledby="alertas-revisar">
      <SectionTitle>
        <span id="alertas-revisar">Alertas para revisar</span>
      </SectionTitle>
      {d.alerts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface/60 px-5 py-4 text-sm text-text-2">
          No hay alertas abiertas. Si el tutor detecta algo que conviene mirar, aparece acá.
        </p>
      ) : (
        <Card as="div">
          <ul className="divide-y divide-line">
            {d.alerts.map((a) => (
              <li key={a.id}>
                <Link
                  to="/app/sesiones/$sessionId"
                  params={{ sessionId: a.sessionId }}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-paper"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text">{a.name}</span>
                      <Badge tone={a.severity === "immediate" ? "rose" : "amber"}>{ALERT_SEVERITY_LABELS[a.severity]}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-text-2">
                      {a.studentName} · {a.activityTitle}
                    </span>
                    <span className="block text-xs text-text-3">{fmtRelative(a.createdAt)}</span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-text-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {d.counts.openAlerts > d.alerts.length ? (
            <p className="border-t border-line px-5 py-3 text-sm text-text-3">
              Mostramos {d.alerts.length} de {d.counts.openAlerts} alertas abiertas. Las demás están en la pestaña En vivo de cada actividad.
            </p>
          ) : null}
        </Card>
      )}
    </section>
  );
}

function RecentActivities({ d, onNewRoom }: { d: DashboardResponse; onNewRoom: () => void }) {
  return (
    <section aria-labelledby="actividades-recientes">
      <SectionTitle
        extra={
          <Link to="/app/aulas" className="text-sm font-semibold text-ink underline decoration-lilac underline-offset-4">
            Ver aulas
          </Link>
        }
      >
        <span id="actividades-recientes">Actividades recientes</span>
      </SectionTitle>
      {d.recent.length === 0 ? (
        <EmptyState
          icon={<LayoutList className="size-8" />}
          title="Todavía no hay actividades"
          description={
            d.counts.classrooms === 0 ? "Empezá por crear un aula; después le sumás actividades." : "Entrá a un aula y creá tu primera actividad."
          }
          action={
            d.counts.classrooms === 0 ? (
              <Button icon={<Plus className="size-4" />} onClick={onNewRoom}>
                Nueva aula
              </Button>
            ) : (
              <ButtonLink to="/app/aulas">Ir a mis aulas</ButtonLink>
            )
          }
        />
      ) : (
        <Card as="div">
          <ul className="divide-y divide-line">
            {d.recent.map((a) => {
              const st = activityState(a);
              return (
                <li key={a.id}>
                  <Link
                    to="/app/actividades/$activityId"
                    params={{ activityId: a.id }}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-paper"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-ink">{a.title}</span>
                        <Badge tone={st.tone} dot={st.open}>
                          {st.label}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-text-2">{a.classroomName}</span>
                      <span className={cn("block text-xs", a.activeNow > 0 ? "font-semibold text-leaf" : "text-text-3")}>
                        {a.activeNow > 0
                          ? `${plural(a.activeNow, "alumno", "alumnos")} ahora`
                          : a.participants > 0
                            ? `${plural(a.participants, "participante", "participantes")} · ${a.completed} terminaron`
                            : `Editada ${fmtRelative(a.updatedAt)}`}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-text-3" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Plus, Sparkles } from "lucide-react";
import { Button, ButtonLink } from "@client/components/ui/button";
import { Card } from "@client/components/ui/misc";
import { cn } from "@client/lib/cn";
import { ClassroomFormDialog } from "@client/features/classrooms/classroom-form";
import { NewActivityDialog } from "@client/features/activities/new-activity-dialog";
import type { DashboardOnboarding } from "@shared/contracts/dashboard";

/** First steps, ticked from real data: a classroom, an activity, published, a student inside. */
export function OnboardingChecklist({ o }: { o: DashboardOnboarding }) {
  const [newRoom, setNewRoom] = useState(false);
  const [newActivity, setNewActivity] = useState(false);
  const navigate = useNavigate();

  const steps = [
    {
      done: o.hasClassroom,
      title: "Crear un aula",
      body: "Un aula por curso: ahí se juntan las actividades y los alumnos.",
      action: (
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setNewRoom(true)}>
          Nueva aula
        </Button>
      ),
    },
    {
      done: o.hasActivity,
      title: "Crear una actividad",
      body: "Escribí la consigna y sumá tu material, o pedile a la IA que te proponga una a partir de un PDF o una foto.",
      action: o.classroomId ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setNewActivity(true)}>
            Nueva actividad
          </Button>
          <ButtonLink to="/app/crear" search={{ aula: o.classroomId }} size="sm" variant="lilac" icon={<Sparkles className="size-4" />}>
            Crear con IA
          </ButtonLink>
        </div>
      ) : (
        <p className="text-sm text-text-3">Primero creá un aula.</p>
      ),
    },
    {
      done: o.hasPublished,
      title: "Publicarla",
      body: "Cuando la publicás se activa su enlace para compartir con tus alumnos.",
      action: o.draftActivityId ? (
        <ButtonLink to="/app/actividades/$activityId" params={{ activityId: o.draftActivityId }} size="sm">
          Abrir la actividad
        </ButtonLink>
      ) : (
        <p className="text-sm text-text-3">Primero creá una actividad.</p>
      ),
    },
    {
      done: o.hasStudentSession,
      title: "Compartir el enlace",
      body: "Pasales el enlace o el código QR. Este paso se marca solo cuando entra el primer alumno.",
      action: o.publishedActivityId ? (
        <ButtonLink to="/app/actividades/$activityId" params={{ activityId: o.publishedActivityId }} size="sm">
          Ver el enlace
        </ButtonLink>
      ) : (
        <p className="text-sm text-text-3">Primero publicá una actividad.</p>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h2 className="font-display text-lg font-semibold text-ink">Primeros pasos</h2>
        <p className="tabular text-sm font-semibold text-text-2">
          {doneCount} de {steps.length} hechos
        </p>
      </div>
      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <div className="h-full rounded-full bg-leaf-bright transition-[width]" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 divide-y divide-line">
        {steps.map((s, i) => (
          <li
            key={s.title}
            aria-current={i === current ? "step" : undefined}
            className={cn("flex gap-4 px-5 py-4", i === current && "bg-lilac-soft/40")}
          >
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                s.done ? "bg-leaf text-white" : i === current ? "bg-ink text-white" : "border border-line-strong text-text-3",
              )}
            >
              {s.done ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-semibold", s.done ? "text-text-2 line-through decoration-text-3/60" : "text-text")}>
                {s.title}
                {s.done ? <span className="sr-only"> (hecho)</span> : null}
              </p>
              {!s.done ? (
                <>
                  <p className="mt-0.5 text-sm leading-6 text-text-2">{s.body}</p>
                  {i === current ? <div className="mt-3">{s.action}</div> : null}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <ClassroomFormDialog
        open={newRoom}
        onOpenChange={setNewRoom}
        onSaved={(c) => void navigate({ to: "/app/aulas/$classroomId", params: { classroomId: c.id } })}
      />
      {o.classroomId ? <NewActivityDialog classroomId={o.classroomId} open={newActivity} onOpenChange={setNewActivity} /> : null}
    </Card>
  );
}

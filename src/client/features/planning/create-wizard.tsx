import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, RotateCcw, Send } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { FormError } from "@client/components/ui/field";
import { PageHeader } from "@client/components/ui/misc";
import { errorMessage } from "@client/lib/api";
import { useClassrooms } from "@client/features/classrooms/api";
import { NO_FILTERS, useMaterials } from "@client/features/materials/api";
import { useTutors } from "@client/features/tutors/api";
import { newRequestId, useSingleFlight } from "@client/features/activities/single-flight";
import { WIZARD_STEPS } from "@shared/domain/planning";
import { useCreateFromProposal } from "./api";
import { StepHeading, Stepper } from "./wizard-parts";
import { StepClass, classErrors, gradeOf } from "./step-class";
import { StepMaterial, materialErrors } from "./step-material";
import { StepFocus } from "./step-focus";
import { StepProposals, proposalErrors } from "./step-proposals";
import { StepTutor } from "./step-tutor";
import { StepReview } from "./step-review";
import { effectiveTutorId, hasProgress, useWizard, type WizardState } from "./wizard-state";

const HEADINGS: { title: string; description: string }[] = [
  { title: "Datos de la clase", description: "Contanos de qué se trata. La IA usa todo esto para armar las propuestas." },
  {
    title: "Material",
    description: "Subí el PDF, Word, foto o texto con el que vas a trabajar. Se lee completo, sin límite de páginas, y queda guardado en Mis materiales.",
  },
  { title: "Enfoque", description: "Qué querés que piensen y hagan tus alumnos." },
  { title: "Propuestas", description: "Generá tres propuestas a partir de tu material, elegí una y editala. Si preferís, escribila vos." },
  { title: "Tutor", description: "Elegí cómo conversa la IA con tus alumnos en esta actividad." },
  { title: "Revisar y crear", description: "Revisá todo antes de crear. Después vas a poder seguir editando la actividad." },
];

export function CreateWizard({ teacherId, aula }: { teacherId: string; aula?: string }) {
  const { state: s, update, reset } = useWizard(teacherId);
  const rooms = useClassrooms(false, "editable");
  const lib = useMaterials(NO_FILTERS);
  const create = useCreateFromProposal();
  const tutors = useTutors();
  const start = useSingleFlight(create.isPending);
  // One id per wizard run: Crear y publicar clicked twice (or retried) creates one activity with one link (D01).
  const requestId = useRef(newRequestId());
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [visibleErrors, setVisibleErrors] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const mounted = useRef(false);

  // A saved state can point past "Propuestas" without a draft (e.g. cleared storage): go back there.
  const step = !s.draft && s.step > 3 ? 3 : Math.min(Math.max(0, s.step), WIZARD_STEPS.length - 1);

  // ?aula=<id> (from a classroom page) preselects that classroom.
  useEffect(() => {
    if (aula && aula !== s.classroomId) update({ classroomId: aula });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aula]);
  // Prefill subject and grade from the chosen classroom when they are still empty.
  useEffect(() => {
    const c = rooms.data?.find((r) => r.id === s.classroomId);
    if (!c) return;
    const subject = s.subject || c.subject;
    const grade = s.grade || gradeOf(c);
    if (subject !== s.subject || grade !== s.grade) update({ subject, grade });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms.data, s.classroomId]);
  // Move focus to the step title on every step change (not on first load).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    document.getElementById("wizard-stepper")?.scrollIntoView({ block: "start", behavior: "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const errorsFor = (i: number, st: WizardState = s): Record<string, string> => {
    if (i === 0) return classErrors(st, rooms.data?.map((r) => r.id));
    if (i === 1) return materialErrors(st, lib.data?.materials);
    if (i === 3) return proposalErrors(st);
    return {};
  };

  const go = (target: number) => {
    if (target < 0 || target >= WIZARD_STEPS.length) return;
    if (target > step) {
      for (let k = step; k < target; k++) {
        const e = errorsFor(k);
        if (Object.keys(e).length) {
          setVisibleErrors(k);
          if (k !== step) update({ step: k });
          else
            setTimeout(() => {
              const el = document.querySelector<HTMLElement>("[aria-invalid='true'], [role='alert']");
              el?.focus?.();
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
            }, 0);
          return;
        }
      }
    }
    setVisibleErrors(null);
    update((cur) => ({ step: target, maxStep: Math.max(cur.maxStep, target) }));
  };

  const errors = visibleErrors === step ? errorsFor(step) : {};

  const submit = (publish: boolean) => {
    if (!s.draft || tutors.isPending || !start()) return;
    const d = s.draft;
    create.mutate(
      {
        classroomId: s.classroomId,
        subject: s.subject,
        proposal: { ...d, reflectionQuestions: d.reflectionQuestions.map((q) => q.trim()).filter(Boolean) },
        tutorId: effectiveTutorId(s, tutors.data),
        requestId: requestId.current,
        materialIds: s.materialIds,
        extraText: s.extraText,
        publish,
        language: s.language ?? "es",
      },
      {
        onSuccess: (r) => {
          toast.success(r.status === "published" ? "Actividad publicada: ya tiene su enlace para compartir" : "Actividad guardada como borrador");
          if (r.skipped.length) {
            toast.warning(`No se pudo agregar: ${r.skipped.map((x) => `«${x.title}» (${x.reason})`).join("; ")}`, { duration: 12_000 });
          }
          reset();
          requestId.current = newRequestId();
          void navigate({ to: "/app/actividades/$activityId", params: { activityId: r.activityId } });
        },
      },
    );
  };

  const h = HEADINGS[step]!;
  const last = step === WIZARD_STEPS.length - 1;

  return (
    <>
      <PageHeader
        title="Crear con IA"
        description="Subí el material de tu clase y la IA te propone tres actividades para trabajar con el tutor socrático. Vos elegís, editás y decidís cuándo publicarla."
        actions={
          hasProgress(s) ? (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>
              Empezar de nuevo
            </Button>
          ) : undefined
        }
      />

      <Stepper step={step} maxStep={Math.max(s.maxStep, step)} onGo={go} />

      <section aria-labelledby="wizard-step-title" className="pb-4">
        <div id="wizard-step-title">
          <StepHeading ref={headingRef} title={h.title} description={h.description} />
        </div>
        {step === 0 ? <StepClass state={s} update={update} errors={errors} /> : null}
        {step === 1 ? <StepMaterial state={s} update={update} errors={errors} /> : null}
        {step === 2 ? <StepFocus state={s} update={update} /> : null}
        {step === 3 ? <StepProposals state={s} update={update} errors={errors} onGoToMaterial={() => go(1)} /> : null}
        {step === 4 && s.draft ? <StepTutor state={s} update={update} /> : null}
        {step === 5 && s.draft ? (
          <>
            <StepReview state={s} onGo={go} />
            <div className="mt-4">
              <FormError message={create.isError ? errorMessage(create.error) : null} />
            </div>
          </>
        ) : null}
      </section>

      <div className="safe-bottom sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:mx-0 lg:rounded-t-lg lg:px-0">
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" icon={<ArrowLeft className="size-4" />} disabled={step === 0 || create.isPending} onClick={() => go(step - 1)}>
            Anterior
          </Button>
          {last ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="secondary" loading={create.isPending && create.variables?.publish === false} disabled={create.isPending || tutors.isPending} onClick={() => submit(false)}>
                Crear como borrador
              </Button>
              <Button icon={<Send className="size-4" />} loading={create.isPending && create.variables?.publish === true} disabled={create.isPending || tutors.isPending} onClick={() => submit(true)}>
                Crear y publicar
              </Button>
            </div>
          ) : (
            <Button onClick={() => go(step + 1)}>
              Siguiente
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Empezar de nuevo?"
        description={<p>Se borra lo que cargaste en este asistente y las propuestas. Los archivos que subiste siguen en Mis materiales.</p>}
        confirmLabel="Empezar de nuevo"
        onConfirm={() => {
          setConfirmReset(false);
          create.reset();
          setVisibleErrors(null);
          const room = aula ? rooms.data?.find((r) => r.id === aula) : undefined;
          reset(aula ? { classroomId: aula, subject: room?.subject ?? "", grade: room ? gradeOf(room) : "" } : {});
        }}
      />
    </>
  );
}

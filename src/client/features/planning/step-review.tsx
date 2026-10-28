import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { useClassrooms } from "@client/features/classrooms/api";
import { NO_FILTERS, useMaterials } from "@client/features/materials/api";
import { useTutors } from "@client/features/tutors/api";
import { helpLabel, typeLabel } from "@client/features/tutors/tutor-visual";
import { classroomLabel } from "@shared/contracts/classrooms";
import { PLANNING_DIFFICULTIES, durationLabel } from "@shared/domain/planning";
import { durationMinutes, effectiveTutorId, type WizardState } from "./wizard-state";

function Row({ label, children, onEdit }: { label: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <div className="grid gap-1 border-b border-line py-3.5 last:border-b-0 sm:grid-cols-[180px_1fr_auto] sm:gap-4">
      <dt className="text-sm font-semibold text-text-3">{label}</dt>
      <dd className="min-w-0 text-[15px] leading-6 break-words text-text">{children}</dd>
      {onEdit ? (
        <div className="sm:text-right">
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit} aria-label={`Cambiar ${label.toLowerCase()}`}>
            Cambiar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const none = <span className="text-text-3">—</span>;

export function StepReview({ state: s, onGo }: { state: WizardState; onGo: (step: number) => void }) {
  const rooms = useClassrooms(false, "editable");
  const lib = useMaterials(NO_FILTERS);
  const tutors = useTutors();
  const d = s.draft!;
  const room = rooms.data?.find((r) => r.id === s.classroomId);
  const mats = s.materialIds.map((id) => lib.data?.materials.find((m) => m.id === id)?.title ?? "Material");
  const tutorId = effectiveTutorId(s, tutors.data);
  const tutor = tutorId ? tutors.data?.find((t) => t.id === tutorId) : null;
  const questions = d.reflectionQuestions.map((q) => q.trim()).filter(Boolean);
  const minutes = durationMinutes(s);

  return (
    <dl className="rounded-lg border border-line bg-surface px-5 shadow-1">
      <Row label="Aula" onEdit={() => onGo(0)}>
        {room ? classroomLabel(room) : none}
      </Row>
      <Row label="Clase" onEdit={() => onGo(0)}>
        {[s.subject, s.grade, s.topic, minutes ? durationLabel(minutes) : ""].filter(Boolean).join(" · ") || none}
      </Row>
      <Row label="Material" onEdit={() => onGo(1)}>
        {mats.length || s.extraText.trim() ? (
          <ul className="list-disc pl-5">
            {mats.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {s.extraText.trim() ? <li>Tu texto ({s.extraText.trim().length} caracteres)</li> : null}
          </ul>
        ) : (
          "Sin material"
        )}
      </Row>
      <Row label="Enfoque" onEdit={() => onGo(2)}>
        {[s.skills.join(", "), `Dificultad ${PLANNING_DIFFICULTIES[s.difficulty].toLowerCase()}`].filter(Boolean).join(" · ")}
      </Row>
      <Row label="Título" onEdit={() => onGo(3)}>
        <span className="font-semibold">{d.title}</span>
      </Row>
      <Row label="Consigna" onEdit={() => onGo(3)}>
        <span className="whitespace-pre-line">{d.instructions}</span>
      </Row>
      <Row label="Objetivos" onEdit={() => onGo(3)}>
        {d.objectives.trim() ? <span className="whitespace-pre-line">{d.objectives}</span> : none}
      </Row>
      <Row label="Reflexión final" onEdit={() => onGo(3)}>
        {questions.length ? (
          <ul className="list-disc pl-5">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        ) : (
          "Sin preguntas de reflexión"
        )}
      </Row>
      <Row label="Tutor" onEdit={() => onGo(4)}>
        {tutor
          ? `${tutor.name} (de Mis tutores${tutor.customized ? ', con tus cambios' : ''}) · ${helpLabel(tutor.helpLevel)}`
          : `${typeLabel(d.tutorType)} · ${helpLabel(d.helpLevel)} (sin un tutor guardado)`}
      </Row>
    </dl>
  );
}

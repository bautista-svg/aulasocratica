import { useId } from "react";
import { cn } from "@client/lib/cn";
import { ACTIVITY_TYPES, COGNITIVE_SKILLS, PLANNING_DIFFICULTIES, type PlanningDifficulty } from "@shared/domain/planning";
import { Chip } from "./wizard-parts";
import type { WizardState } from "./wizard-state";

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function StepFocus({ state: s, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const diffName = useId();
  return (
    <div className="grid gap-7">
      <fieldset>
        <legend className="text-sm font-semibold text-text">Habilidades que querés trabajar</legend>
        <p className="mt-0.5 mb-3 text-[13px] text-text-3">Opcional. Cada propuesta va a ejercitar al menos una.</p>
        <div className="flex flex-wrap gap-2">
          {COGNITIVE_SKILLS.map((k) => (
            <Chip key={k} on={s.skills.includes(k)} onToggle={() => update({ skills: toggle(s.skills, k) })}>
              {k}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-text">Tipos de actividad</legend>
        <p className="mt-0.5 mb-3 text-[13px] text-text-3">Opcional. Si elegís menos de tres, la IA completa con otros tipos.</p>
        <div className="flex flex-wrap gap-2">
          {ACTIVITY_TYPES.map((k) => (
            <Chip key={k} on={s.activityTypes.includes(k)} onToggle={() => update({ activityTypes: toggle(s.activityTypes, k) })}>
              {k}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-text">Dificultad</legend>
        <div className="inline-grid grid-cols-3 gap-1 rounded-md border border-line bg-surface p-1">
          {(Object.entries(PLANNING_DIFFICULTIES) as [PlanningDifficulty, string][]).map(([k, label]) => (
            <label
              key={k}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center rounded-sm px-4 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lilac-ink",
                s.difficulty === k ? "bg-ink text-white" : "text-text-2 hover:text-ink",
              )}
            >
              <input type="radio" name={diffName} value={k} checked={s.difficulty === k} onChange={() => update({ difficulty: k })} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

import { useId } from "react";
import { cn } from "@client/lib/cn";
import { Select } from "@client/components/ui/field";
import { HELP_LEVELS, TUTOR_FOCUS_TYPES, TUTOR_FORMAT_TYPES, TUTOR_TYPE_GUIDANCE, TUTOR_TYPE_INFO } from "@shared/domain/pedagogy";
import { TutorTypeTile } from "./tutor-visual";

/** Tutor type as a native select (grouped), with what the type does and when to choose it. */
export function TutorTypeField({ value, onChange, id, describedBy }: { value: string; onChange: (v: string) => void; id?: string; describedBy?: string }) {
  const info = TUTOR_TYPE_INFO[value];
  const infoId = useId();
  return (
    <div className="grid gap-3">
      <Select id={id} aria-describedby={[describedBy, infoId].filter(Boolean).join(" ")} value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Enfoque del pensamiento">
          {Object.entries(TUTOR_FOCUS_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Formato de la actividad">
          {Object.entries(TUTOR_FORMAT_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </optgroup>
      </Select>
      {info ? (
        <div id={infoId} className="flex gap-3 rounded-md bg-sunken px-3.5 py-3 text-sm leading-6 text-text-2">
          <TutorTypeTile type={value} size="sm" className="mt-0.5" />
          <div className="min-w-0 space-y-1.5">
            <p>{info.description}</p>
            <p>
              <span className="font-semibold text-text">Cuándo elegirlo: </span>
              {info.whenToUse}
            </p>
            {TUTOR_TYPE_GUIDANCE[value] ? (
              <details className="group">
                <summary className="cursor-pointer font-semibold text-lilac-ink select-none">Cómo trabaja el tutor</summary>
                <p className="mt-1">{TUTOR_TYPE_GUIDANCE[value]}</p>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Help level as a radio group with the description of each level. */
export function HelpLevelField({ value, onChange, label = "Cuánto ayuda" }: { value: string; onChange: (v: "autonomous" | "moderate" | "intensive") => void; label?: string }) {
  const name = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-text">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(HELP_LEVELS).map(([k, v]) => (
          <label
            key={k}
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lilac-ink",
              value === k ? "border-ink bg-ink-soft/60" : "border-line-strong bg-surface hover:border-ink/40",
            )}
          >
            <input
              type="radio"
              name={name}
              value={k}
              checked={value === k}
              onChange={() => onChange(k as "autonomous" | "moderate" | "intensive")}
              className="mt-1 size-4 accent-[var(--color-ink)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text">{v.label}</span>
              <span className="block text-[13px] leading-5 text-text-2">{v.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

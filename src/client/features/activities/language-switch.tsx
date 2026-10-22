// "Castellano | English": the language of an activity for its students (their screens, help
// buttons and closing questions, and the tutor's replies). The teacher's screens stay in Spanish.
import { useId } from "react";
import { cn } from "@client/lib/cn";
import { ACTIVITY_LANGUAGES, type ActivityLanguage } from "@shared/domain/language";

const CODES: Record<ActivityLanguage, string> = { es: "ES", en: "EN" };

export function LanguageSwitch({ value, onChange, label = "Idioma para los alumnos" }: { value: ActivityLanguage; onChange: (v: ActivityLanguage) => void; label?: string }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-text">{label}</legend>
      <div className="inline-flex rounded-full border border-line-strong bg-surface p-1 shadow-1">
        {(Object.keys(ACTIVITY_LANGUAGES) as ActivityLanguage[]).map((l) => {
          const checked = value === l;
          return (
            <label
              key={l}
              className={cn(
                "relative inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-[15px] font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lilac-ink max-sm:min-h-11",
                checked ? "bg-ink text-white shadow-1" : "text-text-2 hover:text-ink",
              )}
            >
              <input type="radio" name={name} value={l} checked={checked} onChange={() => onChange(l)} className="sr-only" />
              <span
                className={cn("rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold tracking-wider", checked ? "bg-white/15 text-white" : "bg-sunken text-text-3")}
                aria-hidden="true"
              >
                {CODES[l]}
              </span>
              {ACTIVITY_LANGUAGES[l]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

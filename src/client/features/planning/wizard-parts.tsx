import { forwardRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@client/lib/cn";
import { WIZARD_STEPS } from "@shared/domain/planning";

/** Toggle chip (multi-select) with aria-pressed. */
export function Chip({ on, onToggle, children, disabled }: { on: boolean; onToggle: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50",
        on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-text-2 hover:border-ink/40 hover:text-ink",
      )}
    >
      {on ? <Check className="size-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Heading of the current step; focused on step change so screen readers announce it. */
export const StepHeading = forwardRef<HTMLHeadingElement, { title: string; description?: ReactNode }>(function StepHeading({ title, description }, ref) {
  return (
    <div className="mb-5">
      <h2 ref={ref} tabIndex={-1} className="font-display text-2xl font-semibold text-ink outline-none">
        {title}
      </h2>
      {description ? <p className="mt-1.5 max-w-2xl text-[15px] leading-6 text-text-2">{description}</p> : null}
    </div>
  );
});

export function Stepper({ step, maxStep, onGo }: { step: number; maxStep: number; onGo: (i: number) => void }) {
  return (
    <nav id="wizard-stepper" aria-label="Pasos para crear la actividad" className="mb-6 scroll-mt-20 lg:scroll-mt-6">
      <p className="mb-2 text-sm font-semibold text-text-2 sm:hidden">
        Paso {step + 1} de {WIZARD_STEPS.length}: <span className="text-ink">{WIZARD_STEPS[step]}</span>
      </p>
      <ol className="flex gap-1.5 sm:gap-2">
        {WIZARD_STEPS.map((label, i) => {
          const current = i === step;
          const done = i < step || i <= maxStep;
          const reachable = i <= maxStep;
          return (
            <li key={label} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                aria-label={`Paso ${i + 1}: ${label}${current ? " (actual)" : ""}`}
                onClick={() => onGo(i)}
                className={cn(
                  "group flex min-h-11 w-full flex-col justify-center gap-1.5 rounded-sm text-left disabled:cursor-not-allowed sm:justify-start sm:pt-1",
                  !current && reachable && "hover:opacity-80",
                )}
              >
                <span className={cn("h-1.5 w-full rounded-full transition-colors", current ? "bg-ink" : done ? "bg-lilac" : "bg-line")} aria-hidden="true" />
                <span
                  className={cn(
                    "hidden truncate text-[13px] font-semibold sm:block",
                    current ? "text-ink" : reachable ? "text-text-2" : "text-text-3",
                  )}
                  aria-hidden="true"
                >
                  {i + 1}. {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

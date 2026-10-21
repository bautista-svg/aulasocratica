import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@client/lib/cn";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3.5 text-[16px] text-text placeholder:text-text-3 shadow-1 transition-[border-color,box-shadow] duration-150 hover:border-ink/35 focus:border-lilac-ink focus:outline-none focus:ring-4 focus:ring-lilac/20 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-text-3 aria-invalid:border-rose aria-invalid:ring-rose/15";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  counter?: { value: number; max: number };
}

/** Label + control + hint + error, wired with ids for screen readers. */
export function Field({ label, hint, error, optional, className, children, counter }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-text">
          {label}
          {optional ? <span className="ml-1.5 font-normal text-text-3">(opcional)</span> : null}
        </label>
        {counter ? (
          <span className={cn("tabular text-xs", counter.value > counter.max ? "text-rose" : "text-text-3")} aria-live="polite">
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-[13px] leading-5 text-text-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="text-[13px] font-medium leading-5 text-rose">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11", className)} {...rest} />;
});

/** Textarea that grows with its content (up to maxRows). */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; minRows?: number; maxRows?: number }
>(function Textarea({ className, invalid, minRows = 3, maxRows = 14, value, ...rest }, forwarded) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    const line = 24;
    const min = minRows * line + 20;
    const max = maxRows * line + 20;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
  }, [value, minRows, maxRows]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof forwarded === "function") forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      value={value}
      aria-invalid={invalid || undefined}
      className={cn(control, "resize-none py-2.5 leading-6", className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11 appearance-none pr-10", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-3" aria-hidden="true" />
    </div>
  );
});

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-rose/25 bg-rose-soft px-3.5 py-2.5 text-sm font-medium text-rose">
      {message}
    </div>
  );
}

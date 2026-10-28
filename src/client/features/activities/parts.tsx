// Small building blocks of the activity editor.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Sparkles, X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Button } from "@client/components/ui/button";
import { Input } from "@client/components/ui/field";

/** A titled block of the configuration form, linkable by id. */
export function EditorSection({
  id,
  title,
  description,
  dirty,
  error,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  dirty?: boolean;
  error?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-lg border border-line bg-surface shadow-1">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            {title}
            {error ? (
              <span className="rounded-full bg-rose-soft px-2 py-0.5 font-sans text-xs font-semibold text-rose">Revisar</span>
            ) : dirty ? (
              <span className="rounded-full bg-amber-soft px-2 py-0.5 font-sans text-xs font-semibold text-amber">Sin guardar</span>
            ) : null}
          </h2>
          {description ? <div className="mt-1 max-w-2xl text-sm leading-6 text-text-2">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-4 pt-4 pb-5 sm:px-5">{children}</div>
    </section>
  );
}

/** Accessible radio group rendered as cards (native radios: keyboard and screen readers work as expected). */
export function RadioCards<T extends string>({
  name,
  legend,
  value,
  onChange,
  options,
  columns = 3,
}: {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-text">{legend}</legend>
      <div className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex min-h-11 cursor-pointer gap-3 rounded-md border px-3.5 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lilac-ink",
                checked ? "border-ink bg-ink-soft/60" : "border-line-strong bg-surface hover:border-ink/40",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="mt-1 size-4 shrink-0 accent-[var(--color-ink)]"
              />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-text">{o.label}</span>
                {o.description ? <span className="mt-0.5 block text-[13px] leading-5 text-text-2">{o.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Reviewable AI output: nothing is applied until the teacher chooses to use it. */
export function SuggestionBox({ title = "Sugerencia de la IA", note, children, actions }: { title?: string; note?: ReactNode; children: ReactNode; actions: ReactNode }) {
  return (
    <div role="region" aria-label={title} className="rounded-lg border border-lilac/50 bg-lilac-soft/50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-lilac-ink">
        <Sparkles className="size-4" aria-hidden="true" />
        {title}
      </p>
      {note ? <p className="mt-1 text-[13px] leading-5 text-text-2">{note}</p> : null}
      <div className="mt-3">{children}</div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">{actions}</div>
    </div>
  );
}

/** Title that the teacher can rename in place (Enter saves, Esc cancels). */
export function InlineTitle({
  value,
  onSave,
  saving,
  maxLength = 160,
  readOnly = false,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown>;
  saving: boolean;
  maxLength?: number;
  /** Without the pencil (a reader of a shared classroom). */
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const close = () => {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => editRef.current?.focus());
  };
  const submit = async () => {
    const v = text.trim();
    if (!v) {
      setError("El título no puede quedar vacío.");
      return;
    }
    if (v === value) return close();
    try {
      await onSave(v);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el título.");
    }
  };

  if (!editing) {
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        <h1 className="min-w-0 font-display text-[26px] leading-tight font-semibold break-words text-ink sm:text-[32px]">{value}</h1>
        <Button ref={editRef} variant="ghost" size="icon" className={cn("mt-0.5 shrink-0", readOnly && "hidden")} aria-label="Cambiar el título" onClick={() => setEditing(true)}>
          <Pencil className="size-4.5" />
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="activity-title" className="sr-only">
        Título de la actividad
      </label>
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          id="activity-title"
          value={text}
          maxLength={maxLength}
          invalid={Boolean(error)}
          aria-describedby={error ? "activity-title-error" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className="h-12 font-display text-xl font-semibold text-ink"
        />
        <Button type="submit" size="icon" aria-label="Guardar título" loading={saving}>
          {saving ? null : <Check className="size-5" />}
        </Button>
        <Button variant="secondary" size="icon" aria-label="Cancelar" onClick={close}>
          <X className="size-5" />
        </Button>
      </div>
      {error ? (
        <p id="activity-title-error" role="alert" className="text-[13px] font-medium text-rose">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Horizontal progress bar with an accessible value. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}

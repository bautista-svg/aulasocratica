// Divisions of a classroom (N, F, S…) in the teacher's screens. DivisionChips: the list typed
// as chips; Enter or comma adds one, the ✕ or Backspace on an empty box removes it. What is
// left typed in the box is added on blur, so "Guardar" never loses it.
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { MAX_DIVISIONS, MAX_DIVISION_CHARS, divisionKey, tidyDivision } from "@shared/domain/divisions";

export function DivisionChips({
  id,
  describedBy,
  invalid,
  value,
  onChange,
}: {
  id: string;
  describedBy?: string;
  invalid?: boolean;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const full = value.length >= MAX_DIVISIONS;

  /** Adds what is typed (one or several separated by commas). Returns whether something was typed. */
  function commit(text = draft): boolean {
    const parts = text.split(",").map(tidyDivision).filter(Boolean);
    if (!parts.length) {
      setDraft("");
      return false;
    }
    const next = [...value];
    const repeated: string[] = [];
    let cut = false;
    for (const p of parts) {
      if (next.length >= MAX_DIVISIONS) break;
      const d = Array.from(p).slice(0, MAX_DIVISION_CHARS).join("").trim();
      cut ||= d !== p;
      if (next.some((x) => divisionKey(x) === divisionKey(d))) repeated.push(d);
      else next.push(d);
    }
    setDraft("");
    setNotice(
      repeated.length
        ? `«${repeated[0]}» ya está en la lista.`
        : cut
          ? `Cada división puede tener hasta ${MAX_DIVISION_CHARS} caracteres: la acortamos.`
          : next.length >= MAX_DIVISIONS
            ? `Llegaste al máximo de ${MAX_DIVISIONS} divisiones.`
            : "",
    );
    if (next.length !== value.length) onChange(next);
    return true;
  }

  function remove(i: number) {
    const removed = value[i];
    onChange(value.filter((_, j) => j !== i));
    setNotice(removed ? `Quitaste «${removed}».` : "");
    // After the re-render: with the list full the box was disabled.
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div>
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-1.5 py-1.5 shadow-1 transition-[border-color,box-shadow] duration-150 hover:border-ink/35 focus-within:border-lilac-ink focus-within:ring-4 focus-within:ring-lilac/20",
          invalid && "border-rose ring-rose/15",
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {value.length ? (
          <ul className="contents" aria-label="Divisiones cargadas">
            {value.map((d, i) => (
              <li
                key={divisionKey(d)}
                className="inline-flex h-8 max-w-full items-center gap-0.5 rounded-full bg-ink pl-3 text-sm font-semibold text-white"
              >
                <span className="truncate">{d}</span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Quitar la división ${d}`}
                  className="relative grid size-8 shrink-0 place-items-center rounded-full text-white/80 transition-colors after:absolute after:-inset-1.5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={inputRef}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={draft}
          disabled={full}
          maxLength={MAX_DIVISION_CHARS * 4}
          placeholder={full ? "" : value.length ? "Agregar otra" : "Por ejemplo: N, F, S"}
          enterKeyHint="done"
          autoComplete="off"
          onChange={(e) => {
            const text = e.target.value;
            if (text.includes(",")) {
              const cut = text.lastIndexOf(",");
              commit(text.slice(0, cut));
              setDraft(text.slice(cut + 1).trimStart());
            } else setDraft(text);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              // Adds the chip instead of sending the form.
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && value.length) {
              e.preventDefault();
              remove(value.length - 1);
            }
          }}
          onBlur={() => commit()}
          className="h-8 min-w-28 flex-1 bg-transparent px-2 text-[16px] text-text placeholder:text-text-3 focus:outline-none disabled:hidden"
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {notice && !notice.startsWith("Quitaste") ? <p className="mt-1.5 text-[13px] leading-5 text-amber">{notice}</p> : null}
    </div>
  );
}

/** A student's division next to their name, small (nothing when they have none). */
export function DivisionTag({ division, className }: { division: string; className?: string }) {
  if (!division) return null;
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center rounded bg-lilac-soft px-1.5 text-xs font-bold text-lilac-ink", className)}
      title={`División ${division}`}
    >
      <span className="sr-only">División </span>
      {division}
    </span>
  );
}

// Small helpers so every form validates the same way: the message under the field (never the
// browser's own bubble, which uses another style and the system language) and focus on the
// first field to fix.

/** Moves focus to the first invalid control inside `container`, once React has painted the errors. */
export function focusFirstInvalid(container: HTMLElement | null | undefined) {
  if (!container) return;
  requestAnimationFrame(() => {
    const el = container.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!el) return;
    // Centered, so sticky bars (save bar, bottom navigation) never cover it.
    el.focus({ preventScroll: true });
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  });
}

/** Same rule as the server (`shared/contracts/auth.ts`), so the message appears before sending. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "Escribí tu correo.";
  if (v.length > 160) return "El correo es demasiado largo.";
  if (!EMAIL_RE.test(v)) return "Revisá el correo: parece que no está bien escrito (por ejemplo, nombre@escuela.edu.ar).";
  return undefined;
}

/** Keeps only the defined messages: `{ email: undefined }` → `{}`. */
export function compactErrors<T extends Record<string, string | undefined>>(errors: T): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) as Partial<Record<keyof T, string>>;
}

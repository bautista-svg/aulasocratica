import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";

export const PASSWORD_MIN = 10;

/** Password field with a real show/hide toggle (44 px target, labelled for screen readers). */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-12", className)} autoCapitalize="none" spellCheck={false} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-md text-text-3 hover:text-ink"
      >
        {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
      </button>
    </div>
  );
});

const COMMON = ["123456", "password", "contrasena", "contraseña", "qwerty", "aulasocratica", "111111", "abc123"];

/** Rough, local hint (0–3). It only nudges toward longer passwords; it is not a security audit. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length === 0) return { score: 0, label: "" };
  if (pw.length < PASSWORD_MIN) return { score: 0, label: `Muy corta: usá al menos ${PASSWORD_MIN} caracteres.` };
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c)) || /^(.)\1+$/.test(pw))
    return { score: 1, label: "Fácil de adivinar: evitá secuencias y palabras comunes." };
  let points = 0;
  if (pw.length >= 14) points++;
  if (pw.length >= 18) points++;
  if (/[a-záéíóúñ]/.test(pw) && /[A-ZÁÉÍÓÚÑ]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^\p{L}\p{N}]/u.test(pw)) points++;
  if (points >= 3) return { score: 3, label: "Buena." };
  if (points >= 1) return { score: 2, label: "Aceptable. Más larga es mejor: probá con una frase de varias palabras." };
  return { score: 1, label: "Débil: sumá largo, por ejemplo una frase de varias palabras." };
}

export function StrengthMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  if (!password) return null;
  const tone = s.score >= 3 ? "bg-leaf" : s.score === 2 ? "bg-amber" : "bg-rose";
  return (
    <div className="mt-1">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full", i <= Math.max(1, s.score) ? tone : "bg-line")} />
        ))}
      </div>
      <p className="mt-1 text-[13px] text-text-2" aria-live="polite">
        {s.label}
      </p>
    </div>
  );
}

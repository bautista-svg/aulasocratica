// "Continuar con Google": a plain link (the server redirects to Google and back), drawn like the
// app's own buttons with Google's "G". Hidden while the server has no Google client configured.
import { useQuery } from "@tanstack/react-query";
import { buttonClass } from "@client/components/ui/button";
import { api } from "@client/lib/api";
import { cn } from "@client/lib/cn";

export const GOOGLE_FAILURES = ["cancelado", "vencido", "sin-verificar", "otra-cuenta", "suspendido", "ocupado", "no-disponible", "error"] as const;
export type GoogleFailure = (typeof GOOGLE_FAILURES)[number];

/** Why "Continuar con Google" came back here (the server redirects with ?google=…). */
export const GOOGLE_MESSAGES: Record<GoogleFailure, string> = {
  cancelado: "Cancelaste el ingreso con Google. Podés probar de nuevo o entrar con tu correo.",
  vencido: "El ingreso con Google tardó demasiado o empezó en otra pestaña. Probá de nuevo.",
  "sin-verificar": "Tu cuenta de Google no tiene el correo verificado. Verificalo en Google o entrá con tu correo y contraseña.",
  "otra-cuenta": "Ese correo ya está vinculado a otra cuenta de Google. Entrá con esa cuenta o con tu correo y contraseña.",
  suspendido: "Este espacio fue suspendido por el administrador del sitio.",
  ocupado: "Se están creando muchas cuentas en este momento. Probá de nuevo en unos minutos.",
  "no-disponible": "El ingreso con Google no está disponible por ahora. Entrá con tu correo y contraseña.",
  error: "No pudimos completar el ingreso con Google. Probá de nuevo en un momento.",
};

export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth", "providers"],
    queryFn: ({ signal }) => api.get<{ google: boolean }>("/api/auth/providers", signal),
    staleTime: 10 * 60_000,
  });
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-5 shrink-0", className)} aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** `next`: where to land after signing in (a path inside the app). */
export function GoogleButton({ next = "/app", label = "Continuar con Google", className }: { next?: string; label?: string; className?: string }) {
  const providers = useAuthProviders();
  if (!providers.data?.google) return null;
  return (
    <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`} className={buttonClass("secondary", "lg", cn("w-full gap-3", className))}>
      <GoogleG />
      {label}
    </a>
  );
}

/** "o con tu correo": between Google and the email form, only when Google is offered. */
export function OrDivider({ label, className }: { label: string; className?: string }) {
  const providers = useAuthProviders();
  if (!providers.data?.google) return null;
  return (
    <div className={cn("flex items-center gap-3 text-[13px] font-semibold text-text-3", className)}>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      {label}
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

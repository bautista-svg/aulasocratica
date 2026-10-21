import type { ReactNode } from "react";
import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Logo } from "../brand/logo";
import { Button, buttonClass } from "../ui/button";
import { errorMessage } from "@client/lib/api";
import { usePageTitle } from "@client/lib/page-title";
import { useInAppShell } from "./shell";

/**
 * Inside the panel the page already has the logo, the navigation and the <main> landmark, so a
 * route state renders as plain content; elsewhere it is a full page with its own <main>.
 */
function Frame({ children, role }: { children: ReactNode; role?: "alert" }) {
  return useInAppShell() ? (
    <div role={role} className="mx-auto flex min-h-[50dvh] max-w-lg flex-col items-center justify-center px-2 text-center">
      {children}
    </div>
  ) : (
    <main id="contenido" role={role} className="mx-auto flex min-h-[70dvh] max-w-lg flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}

export function NotFound() {
  usePageTitle("Página no encontrada");
  const inApp = useInAppShell();
  return (
    <Frame>
      {inApp ? null : <Logo className="mb-8" />}
      <h1 className="q-hang font-display text-2xl text-ink">¿Seguro que era esta dirección?</h1>
      <p className="mt-4 text-text-2">La página que buscás no existe o cambió de lugar.</p>
      <Link to={inApp ? "/app" : "/"} className={buttonClass("primary", "md", "mt-6")}>
        Ir al inicio
      </Link>
    </Frame>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  usePageTitle("Algo salió mal");
  const router = useRouter();
  return (
    <Frame role="alert">
      <h1 className="font-display text-2xl font-semibold text-ink">Algo salió mal</h1>
      <p className="mt-3 text-text-2">{errorMessage(error) || "No pudimos mostrar esta pantalla."}</p>
      <div className="mt-6 flex gap-2">
        <Button
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Reintentar
        </Button>
        <Link to="/" className={buttonClass("secondary")}>
          Ir al inicio
        </Link>
      </div>
    </Frame>
  );
}

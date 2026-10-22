import { Outlet, createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogIn } from "lucide-react";
import { deviceHadAccount, sessionWasLost, useMe, useStartWorkspace } from "@client/lib/session";
import { usePageTitle } from "@client/lib/page-title";
import { AppShell } from "@client/components/app/shell";
import { WhatsNew } from "@client/components/app/whats-new";
import { PageSpinner } from "@client/components/ui/spinner";
import { ErrorState, Notice } from "@client/components/ui/misc";
import { Button, buttonClass } from "@client/components/ui/button";
import { Logo } from "@client/components/brand/logo";
import { FormError } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const me = useMe();
  if (me.isPending) return <PageSpinner label="Abriendo tu espacio…" />;
  if (me.isError) {
    return (
      <main id="contenido" className="mx-auto max-w-lg px-4 py-16">
        <h1 className="sr-only">Mi espacio</h1>
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  if (!me.data.teacher) return <NoWorkspace />;
  return (
    <AppShell me={me.data.teacher}>
      <Outlet />
      <WhatsNew me={me.data.teacher} />
    </AppShell>
  );
}

/**
 * Reached /app without a workspace on this device: start one or sign in. When the session was
 * open a moment ago (closed from another device or expired) or this device used an account,
 * signing in comes first and the screen says why: starting a new, empty workspace by mistake
 * is the risk here.
 */
function NoWorkspace() {
  usePageTitle("Abrir tu espacio");
  const start = useStartWorkspace();
  // Read once: the flags describe how we got here, not something that changes on screen.
  const [lost] = useState(sessionWasLost);
  const [hadAccount] = useState(deviceHadAccount);
  const signInFirst = lost === "account" || (!lost && hadAccount);

  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      <h1 className="font-display text-3xl font-semibold text-ink">
        {lost ? "Tu sesión se cerró en este dispositivo" : "No hay un espacio abierto en este dispositivo"}
      </h1>
      {lost ? (
        <div role="alert">
          <Notice tone="amber" className="mt-5" title={lost === "account" ? "Volvé a entrar con tu cuenta" : "Tu espacio ya no está abierto acá"}>
            {lost === "account"
              ? "Puede que hayas cambiado o recuperado la contraseña en otro dispositivo, o que la sesión haya vencido. Si estabas guardando algo justo en ese momento, no llegó a guardarse; todo lo anterior sigue en tu cuenta."
              : "Puede que se haya borrado desde otra pestaña o que se hayan borrado los datos de este navegador. Si estabas guardando algo justo en ese momento, no llegó a guardarse."}
          </Notice>
        </div>
      ) : (
        <p className="mt-3 leading-7 text-text-2">
          {hadAccount
            ? "En este dispositivo se usó una cuenta. Entrá con tu correo y tu contraseña para abrir tu espacio."
            : "Podés empezar uno nuevo ahora, sin cuenta, o entrar con tu correo si ya creaste una cuenta en otro dispositivo."}
        </p>
      )}
      <div className="mt-8 flex flex-col gap-3">
        {signInFirst ? (
          <>
            <Link to="/ingresar" className={buttonClass("primary", "lg")}>
              <LogIn className="size-5" aria-hidden="true" />
              Entrar con mi cuenta
            </Link>
            <Button variant="secondary" size="lg" loading={start.isPending} onClick={() => start.mutate(undefined)}>
              Empezar un espacio nuevo sin cuenta
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" loading={start.isPending} onClick={() => start.mutate(undefined)}>
              Empezar sin cuenta
            </Button>
            <Link to="/ingresar" className={buttonClass("secondary", "lg")}>
              Ya tengo cuenta
            </Link>
          </>
        )}
      </div>
      <div className="mt-4">
        <FormError message={start.isError ? errorMessage(start.error) : null} />
      </div>
    </main>
  );
}

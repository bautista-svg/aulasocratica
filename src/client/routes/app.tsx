import { Outlet, createFileRoute, Link } from "@tanstack/react-router";
import { useMe, useStartWorkspace } from "@client/lib/session";
import { AppShell } from "@client/components/app/shell";
import { PageSpinner } from "@client/components/ui/spinner";
import { ErrorState } from "@client/components/ui/misc";
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
      <div className="mx-auto max-w-lg px-4 py-16">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }
  if (!me.data.teacher) return <NoWorkspace />;
  return (
    <AppShell me={me.data.teacher}>
      <Outlet />
    </AppShell>
  );
}

/** Reached /app without a workspace on this device: start one or sign in. */
function NoWorkspace() {
  const start = useStartWorkspace();
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      <h1 className="font-display text-3xl font-semibold text-ink">No hay un espacio abierto en este dispositivo</h1>
      <p className="mt-3 leading-7 text-text-2">
        Podés empezar uno nuevo ahora, sin cuenta, o entrar con tu correo si ya creaste una cuenta en otro dispositivo.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Button size="lg" loading={start.isPending} onClick={() => start.mutate(undefined)}>
          Empezar sin cuenta
        </Button>
        <Link to="/ingresar" className={buttonClass("secondary", "lg")}>
          Ya tengo cuenta
        </Link>
      </div>
      <div className="mt-4">
        <FormError message={start.isError ? errorMessage(start.error) : null} />
      </div>
    </main>
  );
}

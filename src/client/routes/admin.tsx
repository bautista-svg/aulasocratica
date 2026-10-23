import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@client/components/brand/logo";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError } from "@client/components/ui/field";
import { ErrorState } from "@client/components/ui/misc";
import { PageSpinner } from "@client/components/ui/spinner";
import { ApiError, errorMessage } from "@client/lib/api";
import { focusFirstInvalid } from "@client/lib/forms";
import { useAdminLogin, useAdminLogout, useAdminOverview, useAdminSession } from "@client/features/admin/api";
import { AdminOverviewPanel } from "@client/features/admin/overview";
import { WorkspacesPanel } from "@client/features/admin/workspaces";
import { RequestsPanel } from "@client/features/admin/requests";
import { PasswordInput } from "@client/features/account/password-input";
import { usePageTitle } from "@client/lib/page-title";

// Platform owner's panel. Not linked from the public UI (robots.txt disallows it too).
export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  usePageTitle("Administración", { noindex: true });
  const session = useAdminSession();
  if (session.isPending) return <PageSpinner />;
  if (session.isError) {
    return (
      <main id="contenido" className="mx-auto max-w-lg px-5 py-16">
        <h1 className="sr-only">Administración</h1>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </main>
    );
  }
  if (session.data.disabled) return <Disabled />;
  return session.data.authenticated ? <Dashboard /> : <Login />;
}

function Disabled() {
  return (
    <main id="contenido" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-8" />
      <h1 className="font-display text-2xl font-semibold text-ink">El panel de administración no está habilitado</h1>
      <p className="mt-3 text-text-2">Este servidor no tiene configurada una contraseña de administración.</p>
      <Link to="/" className={buttonClass("secondary", "md", "mt-6")}>
        Ir al inicio
      </Link>
    </main>
  );
}

function Login() {
  const [password, setPassword] = useState("");
  const [empty, setEmpty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const login = useAdminLogin();
  const locked = login.error instanceof ApiError && login.error.status === 429;
  const wrong = login.error instanceof ApiError && login.error.status === 401 ? errorMessage(login.error) : undefined;
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      <h1 className="font-display text-3xl font-semibold text-ink">Administración</h1>
      <p className="mt-2 text-text-2">Acceso para el responsable de la plataforma.</p>
      <form
        ref={formRef}
        noValidate
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!password) {
            setEmpty(true);
            focusFirstInvalid(formRef.current);
            return;
          }
          login.mutate(password, {
            onSuccess: () => setPassword(""),
            onError: () => focusFirstInvalid(formRef.current),
          });
        }}
      >
        <Field label="Contraseña de administración" error={empty ? "Escribí la contraseña de administración." : wrong}>
          {(p) => (
            <PasswordInput
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setEmpty(false);
              }}
              autoFocus
              disabled={locked}
            />
          )}
        </Field>
        <FormError message={login.isError && !(login.error instanceof ApiError && login.error.status === 401) ? errorMessage(login.error) : null} />
        <Button type="submit" size="lg" loading={login.isPending} disabled={locked}>
          Entrar
        </Button>
      </form>
      <p className="mt-6 text-[13px] leading-5 text-text-3">
        Después de 5 intentos fallidos se bloquea el acceso desde tu conexión durante 15 minutos.
      </p>
    </main>
  );
}

function Dashboard() {
  const logout = useAdminLogout();
  const overview = useAdminOverview(true);
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3">
            <Logo compact />
            <h1 className="truncate font-display text-lg font-semibold text-ink">Administración</h1>
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut className="size-4" />}
            loading={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => toast.success("Sesión de administración cerrada") })}
          >
            Salir
          </Button>
        </div>
      </header>
      {/* One column that never grows past the screen: wide tables scroll inside their own box. */}
      <main id="contenido" className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-4 py-6 sm:px-6 lg:py-10">
        <p className="flex min-w-0 items-start gap-2.5 rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" />
          <span>
            Panel para supervisar el servicio y frenar abusos: muestra cantidades y te deja suspender o reactivar un espacio. No muestra nombres de
            alumnos, conversaciones ni contenido de las actividades. Sí muestra los pedidos de cambios, que las docentes envían al equipo.
          </span>
        </p>
        <RequestsPanel />
        <AdminOverviewPanel />
        <WorkspacesPanel dailyLimit={overview.data?.ai.dailyUsdPerWorkspace ?? null} />
      </main>
    </div>
  );
}

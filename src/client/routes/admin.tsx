import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@client/components/brand/logo";
import { Button, buttonClass } from "@client/components/ui/button";
import { Field, FormError } from "@client/components/ui/field";
import { ErrorState } from "@client/components/ui/misc";
import { PageSpinner } from "@client/components/ui/spinner";
import { ApiError, errorMessage } from "@client/lib/api";
import { useAdminLogin, useAdminLogout, useAdminOverview, useAdminSession } from "@client/features/admin/api";
import { AdminOverviewPanel } from "@client/features/admin/overview";
import { WorkspacesPanel } from "@client/features/admin/workspaces";
import { PasswordInput } from "@client/features/account/password-input";
import { usePageTitle } from "@client/features/account/page-title";

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
  const login = useAdminLogin();
  const locked = login.error instanceof ApiError && login.error.status === 429;
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <Logo className="mb-10" />
      <h1 className="font-display text-3xl font-semibold text-ink">Administración</h1>
      <p className="mt-2 text-text-2">Acceso para el responsable de la plataforma.</p>
      <form
        className="mt-8 grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate(password, {
            onSuccess: () => setPassword(""),
          });
        }}
      >
        <Field
          label="Contraseña de administración"
          error={login.error instanceof ApiError && login.error.status === 401 ? errorMessage(login.error) : undefined}
        >
          {(p) => (
            <PasswordInput
              id={p.id}
              aria-describedby={p.describedBy}
              invalid={p.invalid}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={locked}
            />
          )}
        </Field>
        <FormError message={login.isError && !(login.error instanceof ApiError && login.error.status === 401) ? errorMessage(login.error) : null} />
        <Button type="submit" size="lg" loading={login.isPending} disabled={!password || locked}>
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
            <span className="truncate font-display text-lg font-semibold text-ink">Administración</span>
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
      <main id="contenido" className="mx-auto grid max-w-[1240px] gap-8 px-4 py-6 sm:px-6 lg:py-10">
        <p className="flex items-start gap-2.5 rounded-md bg-sunken px-4 py-3 text-sm leading-6 text-text-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" />
          Vista de solo lectura para supervisar el servicio y frenar abusos. No muestra nombres de alumnos, conversaciones ni contenido de las
          actividades.
        </p>
        <AdminOverviewPanel />
        <WorkspacesPanel dailyLimit={overview.data?.ai.dailyTokensPerWorkspace ?? null} />
      </main>
    </div>
  );
}

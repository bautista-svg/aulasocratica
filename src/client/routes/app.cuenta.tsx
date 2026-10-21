import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, ErrorState, PageHeader } from "@client/components/ui/misc";
import { PageSpinner } from "@client/components/ui/spinner";
import { fmtDate } from "@client/lib/format";
import { useMe } from "@client/lib/session";
import { usePageTitle } from "@client/lib/page-title";
import { WorkspaceNameForm } from "@client/features/account/workspace-name-form";
import { AccountSection } from "@client/features/account/account-section";
import { DeleteWorkspace } from "@client/features/account/delete-workspace";

export const Route = createFileRoute("/app/cuenta")({
  component: AccountPage,
});

function AccountPage() {
  usePageTitle("Mi espacio");
  const me = useMe();
  if (me.isPending) return <PageSpinner />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const t = me.data.teacher;
  if (!t) return null; // the /app layout shows the "no workspace" screen

  return (
    <>
      <PageHeader title="Mi espacio" description="Tu nombre, tu cuenta y qué pasa con tus datos." />
      <div className="grid max-w-3xl gap-5">
        <Card>
          <CardHeader title="Nombre" description={`Espacio creado el ${fmtDate(t.createdAt)}.`} />
          <div className="px-5 pt-4 pb-5">
            <WorkspaceNameForm current={t.displayName} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Cuenta"
            action={t.hasAccount ? <Badge tone="leaf">Con cuenta</Badge> : <Badge tone="amber">Sin cuenta</Badge>}
            description={t.hasAccount ? undefined : "Hoy tu espacio no tiene correo ni contraseña."}
          />
          <div className="px-5 pt-4 pb-5">
            <AccountSection me={t} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Tus datos" />
          <div className="px-5 pt-3 pb-5">
            <p className="flex items-start gap-2.5 text-sm leading-6 text-text-2">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-leaf" aria-hidden="true" />
              <span>
                Qué guardamos, para qué, quién lo procesa y cuánto tiempo, explicado en{" "}
                <Link to="/privacidad" className="font-semibold text-ink underline decoration-lilac underline-offset-4">
                  Privacidad
                </Link>
                .
              </span>
            </p>
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="font-semibold text-text">Borrar mi espacio</h3>
              <p className="mt-1 mb-4 text-sm leading-6 text-text-2">
                Borra para siempre tus aulas, actividades, alumnos y su trabajo, tutores, materiales, archivos e informes
                {t.hasAccount ? ", y también tu cuenta" : ""}.
              </p>
              <DeleteWorkspace me={t} />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

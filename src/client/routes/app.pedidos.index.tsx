import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, MessageSquarePlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, PageHeader, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { errorMessage } from "@client/lib/api";
import { fmtDate } from "@client/lib/format";
import { usePageTitle } from "@client/lib/page-title";
import { useRequestMutations, useRequests } from "@client/features/requests/api";
import { StatusBadge } from "@client/features/requests/bits";
import { REQUEST_KIND_LABELS } from "@shared/contracts/requests";

export const Route = createFileRoute("/app/pedidos/")({ component: RequestsPage });

const STEPS = [
  { title: "Contás qué querés", text: "Con tus palabras, y si querés con una captura de la pantalla." },
  { title: "La IA te pregunta", text: "Hasta entenderlo bien, y te muestra cómo lo entendió." },
  { title: "Lo enviás al equipo", text: "Acá vas a ver cuándo está en curso y cuándo está hecho." },
];

function RequestsPage() {
  usePageTitle("Pedidos de cambios");
  const q = useRequests();
  const { open } = useRequestMutations();
  const navigate = useNavigate();

  const start = () =>
    open.mutate(undefined, {
      onSuccess: (d) => void navigate({ to: "/app/pedidos/$requestId", params: { requestId: d.request.id } }),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <PageHeader
        title="Pedidos de cambios"
        description="Contá qué te gustaría cambiar o agregar en Aula Socrática, o qué no te funciona. Una IA te hace las preguntas necesarias y se lo pasa al equipo, bien claro."
        actions={
          <Button icon={<Plus className="size-4" />} loading={open.isPending} onClick={start}>
            Nuevo pedido
          </Button>
        }
      />

      <ol className="mb-8 grid gap-3 sm:grid-cols-3" aria-label="Cómo funciona">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-[16px] border border-line bg-surface/70 px-4 py-3.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-lilac-soft font-display text-sm font-semibold text-lilac-ink" aria-hidden="true">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{s.title}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-text-2">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>

      {q.isPending ? (
        <SkeletonList rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          level={2}
          icon={<MessageSquarePlus className="size-8" aria-hidden="true" />}
          title="Todavía no hiciste pedidos"
          description="Cuando algo de la app te gustaría que funcione distinto, empezá un pedido y contalo como se lo contarías a alguien."
          action={
            <Button icon={<Plus className="size-4" />} loading={open.isPending} onClick={start}>
              Empezar un pedido
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="mis-pedidos">
          <h2 id="mis-pedidos" className="mb-3 font-display text-lg font-semibold text-ink">
            Tus pedidos
          </h2>
          <ul className="space-y-2.5">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link
                  to="/app/pedidos/$requestId"
                  params={{ requestId: r.id }}
                  className="group flex items-center gap-4 rounded-[16px] border border-line bg-surface px-4 py-4 shadow-1 transition-colors hover:border-ink/30 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.summary ? <span className="text-xs font-semibold text-text-3">{REQUEST_KIND_LABELS[r.summary.kind]}</span> : null}
                    </div>
                    <p className="mt-1.5 truncate font-display text-[17px] font-semibold text-ink">{r.title || "Pedido sin terminar"}</p>
                    <p className="mt-0.5 text-[13px] text-text-3">
                      {r.submittedAt ? `Enviado el ${fmtDate(r.submittedAt)}` : `Empezado el ${fmtDate(r.createdAt)} · sin enviar`}
                      {r.note ? " · el equipo respondió" : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

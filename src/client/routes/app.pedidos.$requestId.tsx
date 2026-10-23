import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Send, Trash2, Undo2 } from "lucide-react";
import { ErrorState, Notice, Skeleton } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { errorMessage } from "@client/lib/api";
import { usePageTitle } from "@client/lib/page-title";
import { useRequest, useRequestMutations } from "@client/features/requests/api";
import { StatusBadge, SummaryCard, TeamNote } from "@client/features/requests/bits";
import { Composer, Conversation } from "@client/features/requests/chat";
import type { ChangeRequestView } from "@shared/contracts/requests";

export const Route = createFileRoute("/app/pedidos/$requestId")({ component: RequestPage });

function RequestPage() {
  const { requestId } = Route.useParams();
  const q = useRequest(requestId);
  usePageTitle(["Pedidos de cambios", q.data?.title || "Nuevo pedido"]);

  return (
    <>
      <Link to="/app/pedidos" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Pedidos de cambios
      </Link>
      {q.isPending ? (
        <div aria-busy="true" aria-label="Cargando el pedido">
          <Skeleton className="h-9 w-2/3 max-w-md" />
          <Skeleton className="mt-6 h-24 w-full max-w-xl" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <RequestView request={q.data} />
      )}
    </>
  );
}

function RequestView({ request }: { request: ChangeRequestView }) {
  const m = useRequestMutations(request.id);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<null | "discard" | "withdraw">(null);
  const open = request.status === "draft" || request.status === "pending";
  const wrote = request.messages.some((x) => x.role === "teacher");
  const thinking = m.reply.isPending;
  const failed = request.awaitingReply && !thinking && !m.send.isPending;

  async function send(text: string, files: File[]) {
    try {
      await m.send.mutateAsync({ text, files });
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
    m.reply.mutate();
  }

  const submit = () =>
    m.submit.mutate(undefined, {
      onSuccess: () => toast.success("Pedido enviado. ¡Gracias! Vas a ver acá cuando esté en curso y cuando esté hecho."),
      onError: (e) => toast.error(errorMessage(e)),
    });

  let footer: React.ReactNode = null;
  if (request.status === "draft") {
    footer = !wrote ? (
      <p className="text-sm leading-6 text-text-2">Contame en el chat qué querés cambiar y voy armando el pedido acá.</p>
    ) : (
      <div className="space-y-3">
        {request.ready ? (
          <p className="text-sm leading-6 text-text-2">Si está bien, envialo. Si algo no es así, decímelo en el chat y lo corrijo.</p>
        ) : (
          <p className="text-sm leading-6 text-text-2">Me falta entender algo, pero si preferís, ya lo podés enviar así.</p>
        )}
        <Button
          className="w-full"
          variant={request.ready ? "primary" : "secondary"}
          icon={<Send className="size-4" />}
          loading={m.submit.isPending}
          disabled={thinking || m.send.isPending}
          onClick={submit}
        >
          {request.ready ? "Enviar pedido" : "Enviar así"}
        </Button>
        <Button className="w-full" variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setConfirm("discard")}>
          Descartar borrador
        </Button>
      </div>
    );
  } else if (request.status === "pending") {
    footer = (
      <div className="space-y-3">
        <p className="text-sm leading-6 text-text-2">El equipo ya lo puede ver. Si te olvidaste de algo, seguí escribiendo en el chat: se suma al pedido.</p>
        <Button className="w-full" variant="ghost" size="sm" icon={<Undo2 className="size-4" />} onClick={() => setConfirm("withdraw")}>
          Cancelar pedido
        </Button>
      </div>
    );
  } else if (request.status === "in_progress") {
    footer = <p className="text-sm leading-6 text-text-2">El equipo está trabajando en esto.</p>;
  }

  return (
    <>
      <header className="mb-6">
        <div className="mb-2">
          <StatusBadge status={request.status} />
        </div>
        <h1 className="font-display text-[26px] leading-tight font-semibold text-balance text-ink sm:text-[32px]">{request.title || "Nuevo pedido"}</h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start">
        <div className="min-w-0 space-y-5">
          {request.note ? <TeamNote request={request} /> : null}
          <Conversation request={request} thinking={thinking} failed={failed} retrying={m.reply.isPending} onRetry={() => m.reply.mutate()} />
          {open ? (
            <Composer request={request} busy={m.send.isPending || thinking} onSend={send} />
          ) : (
            <Notice tone="neutral">Este pedido está cerrado. Si querés pedir algo más, empezá un pedido nuevo.</Notice>
          )}
        </div>
        <div className="lg:sticky lg:top-8">
          <SummaryCard request={request} footer={footer} />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "discard"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Descartar este borrador?"
        description="Se borra la conversación y las capturas. No se envía nada al equipo."
        confirmLabel="Descartar"
        loading={m.discard.isPending}
        onConfirm={() =>
          m.discard.mutate(undefined, {
            onSuccess: () => {
              setConfirm(null);
              void navigate({ to: "/app/pedidos" });
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
      <ConfirmDialog
        open={confirm === "withdraw"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="¿Cancelar este pedido?"
        description="El equipo no lo va a hacer. Queda en tu lista como descartado."
        confirmLabel="Cancelar pedido"
        cancelLabel="Volver"
        loading={m.withdraw.isPending}
        onConfirm={() =>
          m.withdraw.mutate(undefined, {
            onSuccess: () => setConfirm(null),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}

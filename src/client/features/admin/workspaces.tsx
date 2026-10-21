import { useState } from "react";
import { toast } from "sonner";
import { Badge, Card, CardHeader, ErrorState, SkeletonList } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { errorMessage } from "@client/lib/api";
import { fmtDate, fmtRelative } from "@client/lib/format";
import type { AdminWorkspace } from "@shared/contracts/admin";
import { useAdminWorkspaces, useSuspend } from "./api";
import { fmtCompact, fmtNum } from "./overview";

export function WorkspacesPanel({ dailyLimit }: { dailyLimit: number | null }) {
  const q = useAdminWorkspaces(true);
  const suspend = useSuspend();
  const [target, setTarget] = useState<AdminWorkspace | null>(null);
  const list = q.data?.pages.flatMap((p) => p.workspaces) ?? [];

  return (
    <Card>
      <CardHeader title="Espacios" description="Del más nuevo al más viejo. Sin nombres ni contenido: solo cantidades y el correo enmascarado." />
      {q.isPending ? (
        <div className="p-5">
          <SkeletonList rows={3} />
        </div>
      ) : q.isError ? (
        <div className="p-5">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : list.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-text-3">Todavía no hay espacios.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Tabla de espacios">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-y border-line bg-sunken/70 text-left text-xs text-text-2">
                  <th scope="col" className="px-5 py-2 font-semibold">
                    Espacio
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Creado
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Última vez
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Cuenta
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Aulas
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Actividades
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Trabajos
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    IA hoy
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Estado
                  </th>
                  <th scope="col" className="px-5 py-2 font-semibold">
                    <span className="sr-only">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((w) => (
                  <tr key={w.id} className={w.suspended ? "bg-rose-soft/40" : undefined}>
                    <th scope="row" className="px-5 py-2.5 text-left font-mono text-[13px] font-semibold text-text">
                      {w.shortId}
                    </th>
                    <td className="px-3 py-2.5 whitespace-nowrap text-text-2">{fmtDate(w.createdAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-text-2">{fmtRelative(w.lastSeenAt)}</td>
                    <td className="px-3 py-2.5 text-text-2">{w.hasAccount ? w.maskedEmail : <span className="text-text-3">Sin cuenta</span>}</td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(w.classrooms)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(w.activities)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtNum(w.studentSessions)}</td>
                    <td className="tabular px-3 py-2.5 text-right whitespace-nowrap">
                      {fmtCompact(w.aiTokensToday)}
                      {dailyLimit && w.aiTokensToday > 0 ? (
                        <span className="block text-xs text-text-3">
                          {w.aiTokensToday / dailyLimit < 0.01 ? "menos del 1%" : `${Math.min(100, Math.round((w.aiTokensToday / dailyLimit) * 100))}%`} del límite
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{w.suspended ? <Badge tone="rose">Suspendido</Badge> : <Badge tone="leaf">Activo</Badge>}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant={w.suspended ? "secondary" : "ghost"}
                        className={w.suspended ? undefined : "text-rose"}
                        onClick={() => setTarget(w)}
                      >
                        {w.suspended ? "Reactivar" : "Suspender"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-text-3">
            <span>
              {list.length} {list.length === 1 ? "espacio" : "espacios"} cargados
            </span>
            {q.hasNextPage ? (
              <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                Cargar más
              </Button>
            ) : null}
          </div>
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
        }}
        variant={target?.suspended ? "primary" : "danger"}
        title={target?.suspended ? `¿Reactivar el espacio ${target.shortId}?` : `¿Suspender el espacio ${target?.shortId ?? ""}?`}
        description={
          target?.suspended ? (
            <p>El docente vuelve a poder entrar y sus actividades siguen funcionando como antes.</p>
          ) : (
            <>
              <p>Mientras esté suspendido, el docente no puede usar su espacio: todas sus pantallas responden que fue suspendido.</p>
              <p>No se borra nada. Podés reactivarlo cuando quieras. Queda registrado en la auditoría.</p>
            </>
          )
        }
        confirmLabel={target?.suspended ? "Reactivar" : "Suspender"}
        loading={suspend.isPending}
        onConfirm={() => {
          if (!target) return;
          suspend.mutate(
            { id: target.id, suspend: !target.suspended },
            {
              onSuccess: (r) => {
                toast.success(r.suspended ? "Espacio suspendido" : "Espacio reactivado");
                setTarget(null);
              },
              onError: (e) => toast.error(errorMessage(e)),
            },
          );
        }}
      />
    </Card>
  );
}

import { Card, CardHeader, ErrorState, Skeleton, Stat } from "@client/components/ui/misc";
import type { AdminOverview } from "@shared/contracts/admin";
import { useAdminOverview } from "./api";

const num = new Intl.NumberFormat("es-AR");
const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const fmtNum = (n: number) => num.format(n);
export const fmtCompact = (n: number) => compact.format(n);
export const fmtUsd = (n: number) => usd.format(n);

const PURPOSE_LABELS: Record<string, string> = {
  tutor_chat: "Conversación del tutor",
  alert_detection: "Detección de alertas",
  file_extraction: "Lectura de archivos",
  activity_draft: "Borrador de actividad",
  class_proposals: "Propuestas de clase",
  rubric_proposal: "Propuesta de rúbrica",
  rubric_import: "Importar rúbrica",
  rubric_assessment: "Sugerencia de rúbrica",
  deliverable_analysis: "Análisis de entregas",
  aspect_analysis: "Habilidades",
  change_request: "Pedidos de cambios",
  reflection_questions: "Preguntas de reflexión",
  session_summary: "Resumen de un trabajo",
  thinking_xray: "Radiografía",
  report_narrative: "Texto de informes",
  health_check: "Chequeo de disponibilidad",
};

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
};

export function AdminOverviewPanel() {
  const q = useAdminOverview(true);
  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true" aria-label="Cargando">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="rounded-md border border-line bg-surface px-4 py-3">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-3 h-6 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  const t = o.totals;
  return (
    <div className="grid grid-cols-1 gap-6">
      <section aria-labelledby="totales">
        <h2 id="totales" className="mb-3 font-display text-xl font-semibold text-ink">
          Uso de la plataforma
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Espacios" value={fmtNum(t.workspaces)} hint={`${fmtNum(t.withAccount)} con cuenta`} />
          <Stat label="Activos (7 días)" value={fmtNum(t.active7)} hint={`${fmtNum(t.active30)} en 30 días`} />
          <Stat label="Suspendidos" value={fmtNum(t.suspended)} />
          <Stat label="Aulas" value={fmtNum(t.classrooms)} />
          <Stat label="Actividades" value={fmtNum(t.activities)} hint={`${fmtNum(t.published)} publicadas`} />
          <Stat label="Trabajos de alumnos" value={fmtNum(t.studentSessions)} />
          <Stat label="Mensajes (7 días)" value={fmtNum(t.messages7)} />
        </div>
      </section>
      <UsageChart ai={o.ai} />
      <PurposeTable ai={o.ai} />
    </div>
  );
}

function UsageChart({ ai }: { ai: AdminOverview["ai"] }) {
  const max = Math.max(1, ...ai.days.map((d) => d.inputTokens + d.outputTokens));
  const totalTokens = ai.days.reduce((n, d) => n + d.inputTokens + d.outputTokens, 0);
  return (
    <Card>
      <CardHeader title="Uso de IA, últimos 14 días" description={`${fmtCompact(totalTokens)} tokens · costo estimado ${fmtUsd(ai.totalCostUsd)}`} />
      <div className="px-5 pt-4 pb-5">
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-text-2" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-ink" /> Entrada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-lilac" /> Salida
          </span>
        </div>
        {/* Visual bars; the same numbers are in the table below for screen readers. */}
        <div className="relative overflow-x-auto pb-1" aria-hidden="true">
          <div className="flex h-44 min-w-[560px] items-end gap-1.5 border-b border-line">
            {ai.days.map((d) => {
              const total = d.inputTokens + d.outputTokens;
              const h = (total / max) * 100;
              return (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="tabular text-[10px] text-text-3">{total ? fmtCompact(total) : ""}</span>
                  <div
                    className="flex w-full max-w-9 flex-col justify-end overflow-hidden rounded-t-[4px]"
                    style={{ height: `${h}%`, minHeight: total ? 2 : 0 }}
                  >
                    <div className="bg-lilac" style={{ flexGrow: d.outputTokens }} />
                    <div className="bg-ink" style={{ flexGrow: d.inputTokens }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex min-w-[560px] gap-1.5 pt-1.5">
            {ai.days.map((d) => (
              <span key={d.day} className="tabular flex-1 text-center text-[10px] text-text-3">
                {dayLabel(d.day)}
              </span>
            ))}
          </div>
        </div>
        {/* sr-only on the wrapper: a <table> ignores width: 1px / overflow and widened the page on phones. */}
        <div className="sr-only">
          <table>
            <caption>Uso de IA por día</caption>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col">Llamadas</th>
                <th scope="col">Tokens de entrada</th>
                <th scope="col">Tokens de salida</th>
                <th scope="col">Costo estimado</th>
              </tr>
            </thead>
            <tbody>
              {ai.days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{dayLabel(d.day)}</th>
                  <td>{fmtNum(d.calls)}</td>
                  <td>{fmtNum(d.inputTokens)}</td>
                  <td>{fmtNum(d.outputTokens)}</td>
                  <td>{fmtUsd(d.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-5 text-text-3">
          Costo estimado con precios de referencia de US$ {ai.pricePerMTok.input.toLocaleString("es-AR", { minimumFractionDigits: 2 })} por millón de tokens de entrada y US${" "}
          {ai.pricePerMTok.output.toLocaleString("es-AR", { minimumFractionDigits: 2 })} por millón de salida; lo leído de la caché se cuenta a la décima parte. No es la factura: el costo real depende de los precios
          vigentes del proveedor y los impuestos. Límites diarios de gasto en IA: US$ {ai.dailyUsdPerWorkspace} por espacio y US$ {ai.dailyUsdGlobal} para todo el servicio.
        </p>
      </div>
    </Card>
  );
}

function PurposeTable({ ai }: { ai: AdminOverview["ai"] }) {
  return (
    <Card>
      <CardHeader title="Uso de IA por función" description="Últimos 14 días." />
      {ai.byPurpose.length === 0 ? (
        <p className="px-5 pt-3 pb-5 text-sm text-text-3">Todavía no hubo llamadas a la IA en este período.</p>
      ) : (
        <div className="relative mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Uso de IA por función">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-y border-line bg-sunken/70 text-left text-xs text-text-2">
                <th scope="col" className="px-5 py-2 font-semibold">
                  Función
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Llamadas
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Entrada
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  <abbr title="Parte de la entrada que se leyó de la caché (cuesta la décima parte)" className="no-underline">
                    De caché
                  </abbr>
                </th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">
                  Salida
                </th>
                <th scope="col" className="px-5 py-2 text-right font-semibold">
                  Costo estimado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ai.byPurpose.map((p) => (
                <tr key={p.purpose}>
                  <th scope="row" className="px-5 py-2.5 text-left font-semibold text-text">
                    {PURPOSE_LABELS[p.purpose] ?? p.purpose}
                  </th>
                  <td className="tabular px-4 py-2.5 text-right">{fmtNum(p.calls)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{fmtCompact(p.inputTokens)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{p.inputTokens ? `${Math.round((p.cacheReadTokens / p.inputTokens) * 100)} %` : "—"}</td>
                  <td className="tabular px-4 py-2.5 text-right">{fmtCompact(p.outputTokens)}</td>
                  <td className="tabular px-5 py-2.5 text-right">{fmtUsd(p.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

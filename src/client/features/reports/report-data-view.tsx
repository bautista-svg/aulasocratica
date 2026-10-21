import { Database } from "lucide-react";
import { Stat } from "@client/components/ui/misc";
import { fmtDateTime } from "@client/lib/format";
import type { ReportData, ReportTable } from "@shared/domain/reports";

/** Pill that says where a block comes from: observed data, the teacher, or the AI. */
export function SourceTag({ source }: { source: "observed" | "teacher" | "ai" }) {
  const map = {
    observed: { label: "Datos observados", cls: "bg-ink-soft text-ink" },
    teacher: { label: "Texto del docente", cls: "bg-leaf-soft text-leaf" },
    ai: { label: "Sugerencia de la IA", cls: "bg-lilac-soft text-lilac-ink" },
  }[source];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map.cls}`}>{map.label}</span>;
}

export function ReportDataView({ data }: { data: ReportData }) {
  return (
    <section aria-labelledby="datos-observados" className="grid gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="datos-observados" className="font-display text-xl font-semibold text-ink">
            Datos observados
          </h2>
          <SourceTag source="observed" />
        </div>
        <p className="mt-1 flex items-start gap-2 text-sm leading-6 text-text-2">
          <Database className="mt-1 size-4 shrink-0 text-text-3" aria-hidden="true" />
          <span>
            Los armó la plataforma con lo registrado en las actividades{data.generatedAt ? ` (al ${fmtDateTime(data.generatedAt)})` : ""}. No se
            editan a mano: si hubo cambios, usá «Actualizar datos». Rúbricas e interpretaciones aparecen solo si las confirmaste.
          </span>
        </p>
      </div>
      {data.headline.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.headline.map((h) => (
            <Stat key={h.label} label={h.label} value={h.value} />
          ))}
        </div>
      ) : null}
      {data.tables.map((t, i) => (
        <DataTable key={`${t.title}-${i}`} table={t} />
      ))}
    </section>
  );
}

function DataTable({ table }: { table: ReportTable }) {
  const wide = table.columns.length > 3;
  return (
    <figure className="min-w-0 rounded-lg border border-line bg-surface shadow-1">
      <figcaption className="px-4 pt-4 sm:px-5">
        <span className="font-semibold text-ink">{table.title}</span>
        {table.note ? <span className="mt-0.5 block text-[13px] leading-5 text-text-3">{table.note}</span> : null}
      </figcaption>
      {table.rows.length === 0 ? (
        <p className="px-4 pt-2 pb-4 text-sm text-text-3 sm:px-5">Sin datos todavía.</p>
      ) : (
        // Scrolls sideways inside its own box on small screens; the page itself never scrolls horizontally.
        <div className="mt-3 overflow-x-auto pb-1" tabIndex={0} role="region" aria-label={`Tabla: ${table.title}`}>
          <table className={wide ? "w-full min-w-[640px] text-sm" : "w-full min-w-[420px] text-sm"}>
            <thead>
              <tr className="border-y border-line bg-sunken/70 text-left">
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-4 py-2 text-xs font-semibold whitespace-nowrap text-text-2 first:pl-4 sm:first:pl-5">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((r, i) => (
                <tr key={i} className="align-top">
                  {table.columns.map((_, j) =>
                    j === 0 ? (
                      <th key={j} scope="row" className="px-4 py-2.5 text-left font-semibold text-text sm:pl-5">
                        {r[j]}
                      </th>
                    ) : (
                      <td key={j} className={typeof r[j] === "number" ? "tabular px-4 py-2.5 text-text" : "px-4 py-2.5 leading-6 text-text-2"}>
                        {r[j]}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

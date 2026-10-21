// Heatmaps of the live view as accessible tables: every cell shows its number, rows and
// columns have headers, and the colour (neutral → lilac) only repeats what the number says.
// More is never painted as "bad": asking for help or writing a lot is not an alarm.
import { useState } from "react";
import { cn } from "@client/lib/cn";
import { Tabs } from "@client/components/ui/controls";
import { Select } from "@client/components/ui/field";
import { formatDuration, intensity } from "@shared/domain/live-monitor";
import { LIVE_WINDOWS, LIVE_WINDOW_LABELS, type LiveSnapshot, type LiveWindow } from "@shared/contracts/live";

// One clock for the whole heatmap: 24 h, like the column headers (no "a. m.").
const hhmm = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtTime = (iso: string) => hhmm.format(new Date(iso));

const SCALE = [
  "bg-sunken text-text-3",
  "bg-lilac/15 text-ink",
  "bg-lilac/30 text-ink",
  "bg-lilac/50 text-ink",
  "bg-lilac/80 text-ink",
  "bg-lilac-ink text-white",
];

function Legend({ note }: { note: string }) {
  return (
    <div className="mt-3 flex flex-col gap-2 text-xs text-text-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span>Menos</span>
        {SCALE.map((c, i) => (
          <span key={i} className={cn("inline-block size-4 rounded-[4px] border border-line", c.split(" ")[0])} />
        ))}
        <span>Más</span>
      </div>
      <p>{note}</p>
    </div>
  );
}

type Mode = "column" | "grid";

function HeatTable({
  caption,
  columns,
  rows,
  format = String,
  mode,
  footer,
  compactHeaders,
}: {
  caption: string;
  columns: { key: string; label: string }[];
  rows: { sessionId: string; studentName: string; values: number[] }[];
  format?: (v: number) => string;
  mode: Mode;
  footer?: { label: string; values: number[] };
  compactHeaders?: boolean;
}) {
  const colMax = columns.map((_, i) => rows.reduce((m, r) => Math.max(m, r.values[i] ?? 0), 0));
  const gridMax = Math.max(0, ...colMax);
  return (
    // relative: keeps sr-only content inside the scroll box (otherwise it widened the page on phones).
    <div role="region" aria-label={caption} tabIndex={0} className="relative max-w-full overflow-x-auto rounded-md border border-line focus-visible:outline-2">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-paper">
            <th scope="col" className="sticky left-0 z-10 min-w-36 bg-paper px-3 py-2 text-left font-semibold text-text-2">
              Alumno
            </th>
            {columns.map((c, i) => (
              <th key={c.key} scope="col" className={cn("px-0.5 py-2 text-center text-xs font-semibold whitespace-nowrap text-text-2", compactHeaders ? "w-11 min-w-11" : "min-w-20 px-1.5")}>
                {compactHeaders ? <span className={i % 3 === 0 ? undefined : "sr-only"}>{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sessionId} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-medium text-text">
                <span className="block max-w-36 truncate sm:max-w-48" title={r.studentName}>
                  {r.studentName}
                </span>
              </th>
              {r.values.map((v, i) => {
                const level = intensity(v, mode === "column" ? colMax[i]! : gridMax);
                return (
                  <td key={i} className="p-0.5">
                    <span className={cn("tabular flex h-9 items-center justify-center rounded-[6px] px-1 text-xs font-semibold whitespace-nowrap", compactHeaders && "min-w-10", SCALE[level])}>
                      {format(v)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-paper">
              <th scope="row" className="sticky left-0 z-10 bg-paper px-3 py-2 text-left font-semibold text-text">
                {footer.label}
              </th>
              {footer.values.map((v, i) => (
                <td key={i} className="tabular px-1.5 py-2 text-center text-xs font-semibold text-text">
                  {format(v)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function Heatmaps({ snapshot, window, onWindowChange }: { snapshot: LiveSnapshot; window: LiveWindow; onWindowChange: (w: LiveWindow) => void }) {
  const [tab, setTab] = useState("ayuda");
  const { help, timeline, stages } = snapshot.heatmaps;
  const bucketMin = Math.max(1, Math.round(timeline.bucketMs / 60_000));
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      listClassName="mb-4"
      items={[
        {
          value: "ayuda",
          label: "Tipo de ayuda",
          content: (
            <div>
              <HeatTable
                caption="Cantidad de mensajes escritos y pedidos de ayuda por alumno"
                columns={help.columns}
                rows={help.rows}
                mode="column"
                footer={{ label: "Total del grupo", values: help.totals }}
              />
              <Legend note="Cada número cuenta veces. «Mensajes escritos» son los que el alumno escribió o dictó sin usar un botón (el mismo número que en su trabajo y en el PDF); los botones de ayuda tienen su propia columna. El color compara a cada alumno con el resto del grupo en esa columna; no indica si está bien o mal." />
            </div>
          ),
        },
        {
          value: "tiempo",
          label: "Actividad en el tiempo",
          content: (
            <div>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-text-2">
                  Acciones del alumno cada {bucketMin} min, entre las {fmtTime(timeline.start)} y las {fmtTime(timeline.end)}.
                </p>
                <label className="flex items-center gap-2 text-sm font-semibold text-text">
                  Período
                  <Select value={window} onChange={(e) => onWindowChange(e.target.value as LiveWindow)} className="h-10 w-auto min-w-48">
                    {LIVE_WINDOWS.map((w) => (
                      <option key={w} value={w}>
                        {LIVE_WINDOW_LABELS[w]}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <HeatTable
                caption={`Acciones de cada alumno por intervalos de ${bucketMin} minutos`}
                columns={timeline.columns.map((c) => ({ key: c.key, label: hhmm.format(new Date(c.key)) }))}
                rows={timeline.rows}
                mode="grid"
                compactHeaders
              />
              <Legend note="Cuenta lo que hizo cada alumno (respuestas, mensajes, pedidos de ayuda). No cuenta entrar, salir, pegar texto ni tus acciones." />
            </div>
          ),
        },
        {
          value: "etapas",
          label: "Tiempo por etapa",
          content: (
            <div>
              <HeatTable caption="Tiempo de cada alumno en cada etapa" columns={stages.columns} rows={stages.rows} mode="column" format={formatDuration} />
              <Legend note="Tiempo entre el inicio y el fin de cada etapa, según lo registrado. Una etapa en curso cuenta hasta la última acción del alumno." />
            </div>
          ),
        },
      ]}
    />
  );
}

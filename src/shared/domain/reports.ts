// Client-safe shape and helpers for teacher reports ("Informes").
// Every report stores a snapshot of observed data (headline + tables) plus
// teacher-editable narrative sections. AI only drafts the narrative.

export type ReportKind = "individual" | "group" | "institutional";

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  individual: "Individual",
  group: "Grupal",
  institutional: "Institucional",
};

export const REPORT_SECTIONS: Record<ReportKind, { key: string; label: string; hint: string }[]> = {
  individual: [
    { key: "evolution", label: "Evolución observada", hint: "Qué cambió entre la respuesta inicial y la final." },
    { key: "difficulties", label: "Dificultades específicas", hint: "Situaciones concretas en las que necesitó ayuda." },
    { key: "recommendations", label: "Recomendaciones de intervención", hint: "Próximos pasos sugeridos." },
  ],
  group: [
    { key: "shared_difficulties", label: "Dificultades compartidas", hint: "Ayudas que pidieron varios alumnos." },
    { key: "evidence", label: "Evidencias de aprendizaje", hint: "Lo que muestran las respuestas y rúbricas confirmadas." },
    { key: "recommendations", label: "Recomendaciones para próximas clases", hint: "Propuestas para el grupo." },
  ],
  institutional: [
    { key: "indicators", label: "Indicadores pedagógicos", hint: "Lectura de la participación y finalización." },
    { key: "training_needs", label: "Necesidades de formación docente", hint: "Temas en los que conviene acompañar a los equipos." },
  ],
};

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportData {
  generatedAt: string;
  subtitle: string;
  headline: { label: string; value: string | number }[];
  tables: ReportTable[];
}

export function emptyNarrative(kind: ReportKind): Record<string, string> {
  return Object.fromEntries(REPORT_SECTIONS[kind].map((s) => [s.key, ""]));
}

export function readNarrative(kind: ReportKind, raw: unknown): Record<string, string> {
  const base = emptyNarrative(kind);
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(base)) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string") base[k] = v.slice(0, 5000);
    }
  }
  return base;
}

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a BOM so Excel opens accents correctly. */
export function reportToCsv(title: string, data: ReportData, narrative: Record<string, string>, kind: ReportKind): string {
  const lines: string[] = [csvCell(title), csvCell(data.subtitle), ""];
  for (const h of data.headline) lines.push([h.label, h.value].map(csvCell).join(","));
  for (const t of data.tables) {
    lines.push("", csvCell(t.title), t.columns.map(csvCell).join(","));
    for (const r of t.rows) lines.push(r.map(csvCell).join(","));
  }
  lines.push("");
  for (const s of REPORT_SECTIONS[kind]) lines.push([s.label, narrative[s.key] ?? ""].map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

/** Counts help requests by type from observed events. */
export const HELP_EVENT_TYPES = [
  ["hint_requested", "Pistas"],
  ["clarification_requested", "No entendí"],
  ["example_requested", "Ejemplos"],
  ["review_requested", "Revisar respuesta"],
] as const;

export function countHelp(events: { eventType: string }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(HELP_EVENT_TYPES.map(([k]) => [k, 0]));
  for (const e of events) if (e.eventType in out) out[e.eventType]!++;
  return out;
}

export function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

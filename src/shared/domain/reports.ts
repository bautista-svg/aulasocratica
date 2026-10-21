// Client-safe shape and helpers for teacher reports ("Informes").
// Every report stores a snapshot of observed data (headline + tables) that the SERVER builds
// from the database, plus teacher-editable narrative sections. AI only drafts the narrative.

export type ReportKind = "individual" | "group" | "overview";
export type ReportStatus = "draft" | "validated";

export const REPORT_KINDS: ReportKind[] = ["individual", "group", "overview"];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  individual: "Individual",
  group: "Grupal",
  overview: "General de mis aulas",
};

export const REPORT_KIND_DESCRIPTIONS: Record<ReportKind, string> = {
  individual: "Un alumno: sus actividades en el aula, ayudas pedidas, respuestas y lo que vos confirmaste.",
  group: "Un aula completa o una actividad: participación, finalización y ayudas del grupo.",
  overview: "Todas tus aulas activas: una mirada general de participación y finalización.",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Borrador",
  validated: "Validado",
};

export interface ReportSection {
  key: string;
  label: string;
  hint: string;
}

export const REPORT_SECTIONS: Record<ReportKind, ReportSection[]> = {
  individual: [
    { key: "evolution", label: "Evolución observada", hint: "Qué cambió entre la respuesta inicial y la final." },
    { key: "difficulties", label: "Dificultades específicas", hint: "Situaciones concretas en las que necesitó ayuda." },
    { key: "recommendations", label: "Recomendaciones de intervención", hint: "Próximos pasos posibles en clase." },
  ],
  group: [
    { key: "shared_difficulties", label: "Dificultades compartidas", hint: "Ayudas que pidieron varios alumnos." },
    { key: "evidence", label: "Evidencias de aprendizaje", hint: "Lo que muestran la finalización y lo que confirmaste." },
    { key: "recommendations", label: "Recomendaciones para próximas clases", hint: "Propuestas concretas para el grupo." },
  ],
  overview: [
    { key: "participation", label: "Participación y finalización", hint: "Cómo se usaron las actividades en tus aulas." },
    { key: "shared_difficulties", label: "Dificultades que se repiten", hint: "Ayudas o alertas que aparecen en varias aulas." },
    { key: "next_steps", label: "Próximos pasos", hint: "Qué te proponés ajustar en tus clases." },
  ],
};

export const NARRATIVE_MAX = 5000;

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** Short explanation of what the table includes (e.g. "Solo niveles confirmados por vos"). */
  note?: string;
}

export interface ReportData {
  generatedAt: string;
  subtitle: string;
  headline: { label: string; value: string | number }[];
  tables: ReportTable[];
}

export function isReportKind(v: unknown): v is ReportKind {
  return v === "individual" || v === "group" || v === "overview";
}

export function emptyNarrative(kind: ReportKind): Record<string, string> {
  return Object.fromEntries(REPORT_SECTIONS[kind].map((s) => [s.key, ""]));
}

/** Only the known sections of the kind, as strings of at most NARRATIVE_MAX characters. */
export function readNarrative(kind: ReportKind, raw: unknown): Record<string, string> {
  const base = emptyNarrative(kind);
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(base)) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string") base[k] = v.slice(0, NARRATIVE_MAX);
    }
  }
  return base;
}

/** Sections that are still empty (a report can only be validated when this is empty). */
export function missingSections(kind: ReportKind, narrative: Record<string, string>): ReportSection[] {
  return REPORT_SECTIONS[kind].filter((s) => !(narrative[s.key] ?? "").trim());
}

/** Accepts any stored value and returns a well-formed snapshot (never trusts its shape). */
export function readReportData(raw: unknown): ReportData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cell = (v: unknown): string | number => (typeof v === "number" && Number.isFinite(v) ? v : String(v ?? ""));
  return {
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
    subtitle: typeof r.subtitle === "string" ? r.subtitle : "",
    headline: (Array.isArray(r.headline) ? r.headline : [])
      .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
      .map((h) => ({ label: String(h.label ?? ""), value: cell(h.value) })),
    tables: (Array.isArray(r.tables) ? r.tables : [])
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
      .map((t) => ({
        title: String(t.title ?? ""),
        columns: (Array.isArray(t.columns) ? t.columns : []).map((c) => String(c ?? "")),
        rows: (Array.isArray(t.rows) ? t.rows : []).filter(Array.isArray).map((row) => (row as unknown[]).map(cell)),
        ...(typeof t.note === "string" && t.note ? { note: t.note } : {}),
      })),
  };
}

// ── CSV ──
// Excel with Argentine regional settings uses ";" as the list separator, so a comma CSV
// opens in a single column. The BOM makes Excel read the file as UTF-8 (accents, ñ).

export const CSV_SEPARATOR = ";";

const NUMERIC_TEXT = /^-?\d+([.,]\d+)?%?$/;

function csvCell(v: string | number): string {
  if (typeof v === "number") return String(v);
  let s = String(v ?? "");
  // Spreadsheet formula injection: text starting with = + - @ (or tab/CR) would run as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC_TEXT.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: (string | number)[]) => cells.map(csvCell).join(CSV_SEPARATOR);

/** CSV (";" separator, CRLF, UTF-8 BOM) with title, scope, status, headline, tables and narrative. */
export function reportToCsv(
  report: { title: string; kind: ReportKind; status: ReportStatus; validatedAt?: string | null },
  data: ReportData,
  narrative: Record<string, string>,
): string {
  const lines: string[] = [
    row([report.title]),
    row([data.subtitle]),
    row(["Tipo", REPORT_KIND_LABELS[report.kind]]),
    row(["Estado", report.status === "validated" ? "Validado por el docente" : "Borrador (sin validar)"]),
    "",
    row(["Datos observados"]),
  ];
  for (const h of data.headline) lines.push(row([h.label, h.value]));
  for (const t of data.tables) {
    lines.push("", row([t.title]));
    if (t.note) lines.push(row([t.note]));
    lines.push(row(t.columns));
    if (t.rows.length === 0) lines.push(row(["Sin datos todavía"]));
    for (const r of t.rows) lines.push(row(r));
  }
  lines.push("", row(["Valoración del docente"]));
  for (const s of REPORT_SECTIONS[report.kind]) lines.push(row([s.label, narrative[s.key] ?? ""]));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Safe file name base for downloads ("Informe grupal — 5.º B" → "Informe grupal - 5.º B"). */
export function reportFileName(title: string, ext: "csv" | "pdf"): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "Informe"}.${ext}`;
}

// ── Observed help requests ──

/** Help requests counted in reports (observed events, never inferred). */
export const HELP_EVENT_TYPES = [
  ["hint_requested", "Pistas"],
  ["clarification_requested", "No entendí"],
  ["example_requested", "Ejemplos"],
  ["review_requested", "Revisar respuesta"],
] as const;

export type HelpEventType = (typeof HELP_EVENT_TYPES)[number][0];
export const HELP_EVENT_KEYS: HelpEventType[] = HELP_EVENT_TYPES.map(([k]) => k);

/** Counts help requests by type. Rows can be single events or pre-aggregated ({ eventType, n }). */
export function countHelp(events: { eventType: string; n?: number }[]): Record<HelpEventType, number> {
  const out = Object.fromEntries(HELP_EVENT_KEYS.map((k) => [k, 0])) as Record<HelpEventType, number>;
  for (const e of events) {
    if (e.eventType in out) out[e.eventType as HelpEventType] += e.n ?? 1;
  }
  return out;
}

export function totalHelp(counts: Record<HelpEventType, number>): number {
  return HELP_EVENT_KEYS.reduce((n, k) => n + counts[k], 0);
}

export function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

/** Minutes between entering and the last signal, as "8 min", "1 h 05 min" or "menos de 1 min". */
export function formatMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "menos de 1 min";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** "texto largo…" with whitespace collapsed (answers in tables are short excerpts). */
export function excerpt(s: string | null | undefined, max = 300): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

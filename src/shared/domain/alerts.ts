// Client-safe catalogue and rules for classroom alerts. Most detection is an AI inference over
// what the student wrote; "observed" alerts (pasting outside text, leaving the app) come from
// the browser instead. The teacher always reviews them. Safety alerts cannot be turned off.
import { quoteAppears } from "./thinking-xray";

export type AlertCategory = "academica" | "conducta" | "seguridad" | "integridad";
export type AlertSeverity = "review" | "immediate";

export const ALERT_CATEGORY_LABELS: Record<AlertCategory, string> = {
  academica: "Académica",
  conducta: "Conducta",
  seguridad: "Seguridad",
  integridad: "Integridad",
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  review: "Revisar pronto",
  immediate: "Atención inmediata",
};

export interface AlertDefinition {
  key: string;
  name: string;
  description: string;
  category: AlertCategory;
  severity: AlertSeverity;
  locked: boolean;
  /** Raised from browser behavior (observed), not by the AI reading the text. */
  observed?: boolean;
}

/** Platform alerts every classroom inherits. Locked ones are always on. */
export const BUILTIN_ALERTS: AlertDefinition[] = [
  { key: "comprehension_gap", name: "Brecha de comprensión", description: "Errores de concepto o confusión declarada sobre el contenido.", category: "academica", severity: "review", locked: false },
  { key: "low_engagement", name: "Poco involucramiento", description: "Desinterés, respuestas mínimas o ruido fuera de tema.", category: "conducta", severity: "review", locked: false },
  { key: "socioemotional", name: "Señal socioemocional", description: "Autocrítica dura o malestar emocional que no llega a ser una crisis.", category: "conducta", severity: "review", locked: false },
  { key: "inappropriate_tone", name: "Tono fuera de lugar", description: "Gritos o un tono que rompe las normas de la clase.", category: "conducta", severity: "review", locked: false },
  { key: "pasted_text", name: "Pegó texto de afuera", description: "Pegó en sus respuestas o en el chat un texto copiado de otra página o aplicación.", category: "integridad", severity: "review", locked: false, observed: true },
  { key: "left_app", name: "Salió de la actividad", description: "Cambió de pestaña o de aplicación durante la actividad por 10 segundos o más.", category: "integridad", severity: "review", locked: false, observed: true },
  { key: "high_risk_content", name: "Contenido de riesgo alto", description: "Violencia, armas u otro contenido de riesgo alto.", category: "seguridad", severity: "immediate", locked: true },
  { key: "aggressive_language", name: "Lenguaje agresivo", description: "Insultos o agresiones dirigidas a personas.", category: "seguridad", severity: "immediate", locked: true },
  { key: "safety_signal", name: "Señal de seguridad", description: "Lenguaje que sugiere autolesión, crisis o angustia aguda.", category: "seguridad", severity: "immediate", locked: true },
];

export const LOCKED_ALERT_KEYS = BUILTIN_ALERTS.filter((a) => a.locked).map((a) => a.key);
export const OBSERVED_ALERT_KEYS = BUILTIN_ALERTS.filter((a) => a.observed).map((a) => a.key);

/** Pastes shorter than this (a word, a number) are not reported. */
export const PASTE_MIN_CHARS = 20;
/** Leaving the app for less than this is not reported. */
export const AWAY_MIN_MS = 10_000;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Should this paste count as text from outside the app? Short pastes and text the
 * student copied inside the activity itself (their own answer, the instructions) are ignored.
 */
export function isOutsidePaste(pasted: string, copiedInside: string[]): boolean {
  const p = squash(pasted);
  if (p.length < PASTE_MIN_CHARS) return false;
  return !copiedInside.some((c) => {
    const s = squash(c);
    return s.length > 0 && (s === p || s.includes(p));
  });
}

/** "1 min 05 s", "40 s". */
export function formatAway(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/** Teacher-facing summary of the paste / away signals grouped into one open alert. */
export function observedAlertReason(
  key: "pasted_text" | "left_app",
  events: { chars?: number; away_ms?: number; from_material?: boolean }[],
): string {
  const n = events.length;
  if (key === "left_app") {
    const total = events.reduce((sum, e) => sum + (e.away_ms ?? 0), 0);
    const longest = events.reduce((max, e) => Math.max(max, e.away_ms ?? 0), 0);
    return n === 1
      ? `Salió de la actividad durante ${formatAway(total)}.`
      : `Salió de la actividad ${n} veces (en total ${formatAway(total)}; la más larga, ${formatAway(longest)}).`;
  }
  const chars = events.reduce((sum, e) => sum + (e.chars ?? 0), 0);
  const material = events.some((e) => e.from_material) ? " Parte coincide con el material de la actividad." : "";
  return n === 1
    ? `Pegó un texto de ${chars} caracteres copiado fuera de la actividad.${material}`
    : `Pegó ${n} textos copiados fuera de la actividad (${chars} caracteres en total).${material}`;
}

export interface ClassroomAlertRow {
  id: string;
  builtinKey: string | null;
  name: string;
  description: string;
  category: string;
  severity: string;
  enabled: boolean;
}

export interface ActiveAlert extends AlertDefinition {
  /** Row id for custom alerts; null for inherited ones. */
  classroomAlertId: string | null;
}

const isCategory = (c: string): c is AlertCategory => c in ALERT_CATEGORY_LABELS;
const isSeverity = (s: string): s is AlertSeverity => s in ALERT_SEVERITY_LABELS;

/** Is this inherited alert on for the classroom? Locked alerts are always on; missing rows mean on. */
export function builtinEnabled(key: string, rows: ClassroomAlertRow[]): boolean {
  if (LOCKED_ALERT_KEYS.includes(key)) return true;
  const row = rows.find((r) => r.builtinKey === key);
  return row ? row.enabled : true;
}

/** Alerts the detector should look for in this classroom. */
export function activeAlerts(rows: ClassroomAlertRow[]): ActiveAlert[] {
  const builtins = BUILTIN_ALERTS.filter((a) => builtinEnabled(a.key, rows)).map((a) => ({ ...a, classroomAlertId: null }));
  const custom = rows
    .filter((r) => !r.builtinKey && r.enabled && r.name.trim())
    .map((r) => ({
      key: `custom:${r.id}`,
      name: r.name.trim().slice(0, 80),
      description: r.description.trim().slice(0, 400),
      category: isCategory(r.category) ? r.category : "academica",
      severity: isSeverity(r.severity) ? r.severity : "review",
      locked: false,
      classroomAlertId: r.id,
    }));
  return [...builtins, ...custom];
}

export const ALERT_DEDUP_WINDOW_MS = 10 * 60_000;
export const MAX_ALERT_EVIDENCE = 300;

/**
 * Keeps detections for alerts that are on, and drops repeats: an open alert of the same
 * kind for the same session within the last 10 minutes is not raised again.
 * Evidence must be a real quote of the student; otherwise the latest message is shown.
 */
export function sanitizeDetections(
  raw: unknown,
  opts: {
    active: ActiveAlert[];
    studentCorpus: string;
    latestText: string;
    recentOpen: { alertKey: string; createdAt: string }[];
    now: number;
  },
): { alert: ActiveAlert; evidence: string; reason: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { alert: ActiveAlert; evidence: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as { key?: unknown; evidence?: unknown; reason?: unknown };
    if (typeof o.key !== "string" || seen.has(o.key)) continue;
    const alert = opts.active.find((a) => a.key === o.key);
    if (!alert) continue;
    const repeated = opts.recentOpen.some(
      (x) => x.alertKey === alert.key && opts.now - new Date(x.createdAt).getTime() < ALERT_DEDUP_WINDOW_MS,
    );
    if (repeated) continue;
    seen.add(alert.key);
    const quote = typeof o.evidence === "string" ? o.evidence.trim() : "";
    const evidence = (quote && quoteAppears(quote, opts.studentCorpus) ? quote : opts.latestText.trim()).slice(0, MAX_ALERT_EVIDENCE);
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
    out.push({ alert, evidence, reason });
  }
  // Immediate-attention alerts first.
  return out.sort((a, b) => (a.alert.severity === b.alert.severity ? 0 : a.alert.severity === "immediate" ? -1 : 1));
}

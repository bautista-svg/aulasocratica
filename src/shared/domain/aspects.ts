// Strengths and areas to reinforce of one student's work. They use a fixed list of aspects so
// the activity and the student pages can count them across works ("8 se destacaron en
// redacción, 5 tienen que reforzar el uso de los materiales").
import { quoteAppears } from "./thinking-xray";

export const ASPECTS = {
  redaccion: { label: "Redacción y claridad", hint: "Escribe oraciones claras y ordenadas, que se entienden." },
  argumentacion: { label: "Argumentación", hint: "Da razones para lo que afirma y las relaciona con su idea." },
  comprension: { label: "Comprensión del tema", hint: "Entiende las ideas centrales de la actividad." },
  materiales: { label: "Uso de los materiales", hint: "Usa datos, ideas o ejemplos de los materiales de la actividad." },
  ejemplos: { label: "Ejemplos y datos", hint: "Apoya sus ideas con ejemplos, datos o casos concretos." },
  pensamiento_critico: { label: "Pensamiento crítico", hint: "Compara, cuestiona, evalúa alternativas o reconoce límites." },
  revision: { label: "Revisión de sus ideas", hint: "Mejora o corrige su respuesta a partir del diálogo." },
  dialogo: { label: "Participación en el diálogo", hint: "Responde las preguntas del tutor y sostiene la conversación." },
  autonomia: { label: "Autonomía", hint: "Avanza con ideas propias, sin depender de pistas ni ejemplos." },
  vocabulario: { label: "Vocabulario del tema", hint: "Usa con sentido los términos propios del tema." },
  creatividad: { label: "Creatividad y propuestas", hint: "Propone ideas o soluciones propias." },
  reflexion: { label: "Reflexión sobre lo aprendido", hint: "Puede decir qué aprendió, cómo lo hizo y qué le costó." },
} as const;

export type AspectKey = keyof typeof ASPECTS;
export const ASPECT_KEYS = Object.keys(ASPECTS) as AspectKey[];
export const isAspectKey = (v: unknown): v is AspectKey => typeof v === "string" && Object.hasOwn(ASPECTS, v);

/**
 * The key the AI meant ("Pensamiento crítico", "pensamiento-critico" → "pensamiento_critico"),
 * or null. Structured outputs do not enforce enums, so unknown aspects are dropped, not fatal.
 */
export function toAspectKey(v: unknown): AspectKey | null {
  if (typeof v !== "string") return null;
  const k = slug(v);
  if (isAspectKey(k)) return k;
  return ASPECT_KEYS.find((key) => slug(ASPECTS[key].label) === k) ?? null;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_");

export function toAspectKind(v: unknown): AspectKind | null {
  const k = typeof v === "string" ? v.trim().toLowerCase() : "";
  return k === "strength" || k === "reinforce" ? k : null;
}

export type AspectKind = "strength" | "reinforce";
export const ASPECT_KIND_LABELS: Record<AspectKind, string> = { strength: "Se destacó en", reinforce: "A reforzar" };

export interface AspectItem {
  id: string;
  aspect: AspectKey;
  kind: AspectKind;
  /** One sentence about what the work shows (AI) or the teacher's note (may be empty). */
  observation: string;
  /** A literal quote of the student, or "" when there is none. */
  evidence: string;
  source: "ai" | "teacher";
}

export const MAX_ASPECT_ITEMS = ASPECT_KEYS.length;
export const ASPECT_NOTE_MAX = 300;

function str(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Cleans stored or AI-generated items: known aspects only, one item per aspect (the first wins)
 * and, when `studentCorpus` is given, only quotes the student really wrote.
 */
export function sanitizeAspects(raw: unknown, studentCorpus: string | null = null): AspectItem[] {
  if (!Array.isArray(raw)) return [];
  const out: AspectItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (!isAspectKey(o.aspect) || seen.has(o.aspect)) continue;
    const kind: AspectKind | null = o.kind === "strength" || o.kind === "reinforce" ? o.kind : null;
    if (!kind) continue;
    const source = o.source === "teacher" ? "teacher" : "ai";
    const observation = str(o.observation, source === "teacher" ? ASPECT_NOTE_MAX : 600);
    if (source === "ai" && !observation) continue;
    const quote = str(o.evidence, 400);
    const evidence = quote && (studentCorpus === null || quoteAppears(quote, studentCorpus)) ? quote : "";
    seen.add(o.aspect);
    out.push({ id: str(o.id, 40) || `${o.aspect}`, aspect: o.aspect, kind, observation, evidence, source });
    if (out.length >= MAX_ASPECT_ITEMS) break;
  }
  return out;
}

/** Puts strengths first, then areas to reinforce, keeping each group in the list order. */
export function byKind(items: AspectItem[]): Record<AspectKind, AspectItem[]> {
  return { strength: items.filter((i) => i.kind === "strength"), reinforce: items.filter((i) => i.kind === "reinforce") };
}

/** One mention of an aspect in a group or student view. */
export interface AspectMention {
  sessionId: string;
  /** The student's name (activity view) or the activity's title (student view). */
  who: string;
  observation: string;
}

export interface AspectTally {
  aspect: AspectKey;
  strengths: AspectMention[];
  reinforce: AspectMention[];
}

/** Counts the aspects of several works, most mentioned first. */
export function tallyAspects(works: { sessionId: string; who: string; items: AspectItem[] }[]): AspectTally[] {
  const map = new Map<AspectKey, AspectTally>();
  for (const w of works) {
    for (const i of w.items) {
      const t = map.get(i.aspect) ?? { aspect: i.aspect, strengths: [], reinforce: [] };
      (i.kind === "strength" ? t.strengths : t.reinforce).push({ sessionId: w.sessionId, who: w.who, observation: i.observation });
      map.set(i.aspect, t);
    }
  }
  const order = (a: AspectKey) => ASPECT_KEYS.indexOf(a);
  return [...map.values()].sort(
    (a, b) => b.strengths.length + b.reinforce.length - (a.strengths.length + a.reinforce.length) || order(a.aspect) - order(b.aspect),
  );
}

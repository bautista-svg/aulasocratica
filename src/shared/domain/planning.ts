// Client-safe vocabulary and rules for the "Crear con IA" wizard.
import { HELP_LEVELS, TUTOR_TYPES } from "./pedagogy";
import { MAX_TUTOR_RULES } from "./tutors";
import { DEFAULT_REFLECTION_QUESTIONS } from "./activity-design";

export const COGNITIVE_SKILLS = [
  "Recordar",
  "Comprender",
  "Aplicar",
  "Analizar",
  "Evaluar",
  "Crear",
  "Argumentar",
  "Formular hipótesis",
  "Resolver problemas",
  "Reflexionar",
] as const;

export const ACTIVITY_TYPES = [
  "Preguntas de exploración",
  "Análisis de casos",
  "Resolución de problemas",
  "Comprensión lectora",
  "Comparación de fuentes",
  "Análisis de errores",
  "Construcción de argumentos",
  "Desafío de pensamiento crítico",
  "Transferencia a nuevas situaciones",
] as const;

export const WIZARD_STEPS = ["Clase", "Material", "Enfoque", "Propuestas", "Tutor", "Revisar"] as const;

export const PLANNING_DIFFICULTIES = {
  basica: "Básica",
  intermedia: "Intermedia",
  avanzada: "Avanzada",
} as const;
export type PlanningDifficulty = keyof typeof PLANNING_DIFFICULTIES;

export const PROPOSAL_COUNT = 3;
export const MIN_REFLECTION = 2;
export const MAX_REFLECTION = 4;

export interface ClassProposal {
  activityType: string;
  title: string;
  /** Written for students (voseo); what they read when they open the activity. */
  instructions: string;
  objectives: string;
  /** For the teacher only; never shown to students. */
  teacherNotes: string;
  tutorType: string;
  helpLevel: "autonomous" | "moderate" | "intensive";
  /** Concrete indications for the tutor of this activity. */
  tutorGuidance: string;
  reflectionQuestions: string[];
  /** Short references to where in the material the proposal is grounded (e.g. "Página 12: ciclo del agua"). */
  materialRefs: string[];
}

export const LIMITS = {
  title: 160,
  instructions: 3000,
  objectives: 2000,
  teacherNotes: 600,
  tutorGuidance: 2000,
  reflection: 300,
  materialRef: 200,
  materialRefs: 6,
} as const;

export function emptyProposal(): ClassProposal {
  return {
    activityType: "",
    title: "",
    instructions: "",
    objectives: "",
    teacherNotes: "",
    tutorType: "pensamiento_critico",
    helpLevel: "moderate",
    tutorGuidance: "",
    reflectionQuestions: DEFAULT_REFLECTION_QUESTIONS.map((q) => q.question),
    materialRefs: [],
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const list = (v: unknown, maxItems: number, maxLen: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

/**
 * Cleans the AI output: known activity types (preferring the ones the teacher asked for),
 * known tutor types (unknown → pensamiento_critico), known help levels, length caps and
 * 2–4 reflection questions. Returns at most 3 proposals; drops ones without title or consigna.
 */
export function sanitizeProposals(raw: unknown, opts: { activityTypes?: string[] } = {}): ClassProposal[] {
  const arr = Array.isArray(raw) ? raw : [];
  const wanted = (opts.activityTypes ?? []).filter((t) => (ACTIVITY_TYPES as readonly string[]).includes(t));
  const used = new Set<string>();
  const out: ClassProposal[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = str(r["title"], LIMITS.title);
    const instructions = str(r["instructions"], LIMITS.instructions);
    if (!title || !instructions) continue;
    let activityType = str(r["activityType"], 80);
    if (!(ACTIVITY_TYPES as readonly string[]).includes(activityType)) {
      activityType = [...wanted, ...ACTIVITY_TYPES].find((t) => !used.has(t)) ?? ACTIVITY_TYPES[0];
    }
    used.add(activityType);
    const tutorType = str(r["tutorType"], 40);
    const helpLevel = str(r["helpLevel"], 20);
    let reflectionQuestions = list(r["reflectionQuestions"], MAX_REFLECTION, LIMITS.reflection);
    if (reflectionQuestions.length < MIN_REFLECTION) {
      for (const d of DEFAULT_REFLECTION_QUESTIONS) {
        if (reflectionQuestions.length >= MIN_REFLECTION) break;
        if (!reflectionQuestions.includes(d.question)) reflectionQuestions = [...reflectionQuestions, d.question];
      }
    }
    out.push({
      activityType,
      title,
      instructions,
      objectives: str(r["objectives"], LIMITS.objectives),
      teacherNotes: str(r["teacherNotes"], LIMITS.teacherNotes),
      tutorType: tutorType in TUTOR_TYPES ? tutorType : "pensamiento_critico",
      helpLevel: helpLevel in HELP_LEVELS ? (helpLevel as ClassProposal["helpLevel"]) : "moderate",
      tutorGuidance: str(r["tutorGuidance"], LIMITS.tutorGuidance),
      reflectionQuestions,
      materialRefs: list(r["materialRefs"], LIMITS.materialRefs, LIMITS.materialRef),
    });
    if (out.length >= PROPOSAL_COUNT) break;
  }
  return out;
}

export interface ComposedRules {
  text: string;
  /** Parts that did not fit in the 3000 characters the tutor receives (shown to the teacher). */
  dropped: ("notas" | "indicaciones" | "tutor")[];
}

/**
 * Teacher indications stored on the activity when it is created from a proposal:
 * the proposal's activity-specific guidance, then the chosen saved tutor's composed rules,
 * then the teacher notes if they still fit. Never cut silently: whatever does not fit is
 * reported in `dropped` so the wizard can say so before creating.
 */
export function composeActivityRules(parts: { guidance: string; tutorRules: string; teacherNotes: string }): ComposedRules {
  const guidance = parts.guidance.trim() ? `Indicaciones para esta actividad: ${parts.guidance.trim()}` : "";
  const tutor = parts.tutorRules.trim();
  const notes = parts.teacherNotes.trim() ? `Notas del docente: ${parts.teacherNotes.trim()}` : "";
  const dropped: ComposedRules["dropped"] = [];
  const blocks: string[] = [];
  const fits = (b: string) => [...blocks, b].join("\n").length <= MAX_TUTOR_RULES;
  if (guidance) {
    if (fits(guidance)) blocks.push(guidance);
    else dropped.push("indicaciones");
  }
  if (tutor) {
    if (fits(tutor)) blocks.push(tutor);
    else dropped.push("tutor");
  }
  if (notes) {
    if (fits(notes)) blocks.push(notes);
    else dropped.push("notas");
  }
  return { text: blocks.join("\n"), dropped };
}

/** "45 min", "1 h 20 min". */
export function durationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

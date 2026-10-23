// "Habilidades": each work is evaluated skill by skill, at one of four levels with a real quote
// of the student as evidence (or "sin evidencia suficiente", which is never a low level). Skills
// come in dimensions; each workspace chooses which ones to evaluate and can add its own, with
// the observable indicators the AI must look for. Asked for by Vanina Gerstner (23-10).

export const DIMENSIONS = {
  cognitiva: "Dimensión cognitiva",
  metacognitiva: "Dimensión metacognitiva",
  proceso: "Dimensión del proceso de aprendizaje",
  comunicacion: "Comunicación",
} as const;
export type SkillDimension = keyof typeof DIMENSIONS;
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as SkillDimension[];
export const isDimension = (v: unknown): v is SkillDimension => typeof v === "string" && Object.hasOwn(DIMENSIONS, v);

export const SKILL_LEVELS = ["inicial", "en_desarrollo", "logrado", "avanzado"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
/** A level, or no valid evaluation from this work. */
export type SkillStatus = SkillLevel | "sin_evidencia";
export const SKILL_STATUSES: SkillStatus[] = [...SKILL_LEVELS, "sin_evidencia"];

export const STATUS_LABELS: Record<SkillStatus, string> = {
  inicial: "Inicial",
  en_desarrollo: "En desarrollo",
  logrado: "Logrado",
  avanzado: "Avanzado",
  sin_evidencia: "Sin evidencia suficiente",
};

/** The explicit rubric every skill is leveled with (its indicators say what to look for). */
export const LEVEL_RUBRIC: Record<SkillStatus, string> = {
  inicial: "Evidencia limitada o necesita acompañamiento para desarrollar la habilidad.",
  en_desarrollo: "Comienza a demostrar la habilidad, aunque de manera irregular o con apoyo.",
  logrado: "Demuestra la habilidad de manera clara y consistente.",
  avanzado: "Aplica la habilidad con profundidad, autonomía y flexibilidad.",
  sin_evidencia: "La conversación no permite una evaluación válida. No es un desempeño bajo.",
};

/** Colors mean one thing each: green achieved, orange on the way, grey not evaluable. */
export type StatusTone = "good" | "grow" | "none";
export function toneOf(s: SkillStatus | null | undefined): StatusTone {
  return s === "logrado" || s === "avanzado" ? "good" : s === "inicial" || s === "en_desarrollo" ? "grow" : "none";
}

export interface SkillDef {
  key: string;
  label: string;
  dimension: SkillDimension;
  /** Observable indicators: what the AI looks for in the conversation. */
  criteria: string[];
  custom: boolean;
}

interface BuiltIn {
  label: string;
  dimension: SkillDimension;
  criteria: string[];
  /** Evaluated unless the workspace turns it off. */
  on: boolean;
}

// Keys are the ones of the former "aspects", so icons and history line up.
export const BUILTIN_SKILLS = {
  argumentacion: {
    label: "Argumentación",
    dimension: "cognitiva",
    on: true,
    criteria: ["Justifica sus respuestas.", "Utiliza evidencias para sostener sus ideas.", "Explica las razones de sus decisiones."],
  },
  creatividad: {
    label: "Creatividad y propuestas",
    dimension: "cognitiva",
    on: true,
    criteria: [
      "Propone soluciones originales o poco habituales.",
      "Genera alternativas frente a un problema.",
      "Establece conexiones entre ideas diferentes.",
      "Desarrolla y mejora sus propuestas.",
    ],
  },
  comprension: {
    label: "Comprensión del tema",
    dimension: "cognitiva",
    on: true,
    criteria: [
      "Explica con sus palabras las ideas centrales del tema.",
      "Relaciona conceptos entre sí.",
      "Aplica lo que entendió a un caso o ejemplo.",
      "Corrige confusiones cuando se las señalan.",
    ],
  },
  pensamiento_critico: {
    label: "Pensamiento crítico",
    dimension: "cognitiva",
    on: true,
    criteria: ["Cuestiona información.", "Contrasta distintas perspectivas.", "Identifica contradicciones.", "Fundamenta sus conclusiones."],
  },
  ejemplos: {
    label: "Ejemplos y datos",
    dimension: "cognitiva",
    on: false,
    criteria: ["Apoya sus ideas con ejemplos concretos.", "Usa datos o casos pertinentes.", "Explica cómo el ejemplo muestra su idea."],
  },
  reflexion: {
    label: "Reflexión sobre lo aprendido",
    dimension: "metacognitiva",
    on: true,
    criteria: ["Reconoce qué aprendió.", "Identifica dificultades.", "Explica qué estrategias utilizó.", "Reconoce qué podría mejorar."],
  },
  revision: {
    label: "Revisión de sus ideas",
    dimension: "metacognitiva",
    on: true,
    criteria: [
      "Reconoce cuando una idea suya no alcanza o no es correcta.",
      "Modifica o amplía su respuesta a partir del diálogo.",
      "Explica qué cambió en su manera de pensar.",
    ],
  },
  autonomia: {
    label: "Autonomía",
    dimension: "metacognitiva",
    on: false,
    criteria: ["Avanza con ideas propias sin pedir pistas.", "Intenta resolver antes de pedir ayuda.", "Decide cómo encarar la tarea."],
  },
  dialogo: {
    label: "Participación en el diálogo",
    dimension: "proceso",
    on: true,
    criteria: [
      "Responde lo que se le pregunta.",
      "Sostiene la conversación con aportes propios.",
      "Hace preguntas para entender mejor.",
      "Retoma lo dicho antes para avanzar.",
    ],
  },
  materiales: {
    label: "Uso de los materiales",
    dimension: "proceso",
    on: true,
    criteria: [
      "Usa datos, ideas o ejemplos de los materiales de la actividad.",
      "Menciona de dónde toma la información.",
      "Relaciona el material con su propia respuesta.",
    ],
  },
  redaccion: {
    label: "Redacción y claridad",
    dimension: "comunicacion",
    on: true,
    criteria: ["Escribe oraciones completas y claras.", "Ordena sus ideas de manera que se entienden.", "Usa conectores para relacionar ideas."],
  },
  vocabulario: {
    label: "Vocabulario del tema",
    dimension: "comunicacion",
    on: false,
    criteria: ["Usa los términos propios del tema.", "Los usa con el sentido correcto.", "Explica términos con sus palabras."],
  },
} satisfies Record<string, BuiltIn>;

export type BuiltinSkillKey = keyof typeof BUILTIN_SKILLS;
export const BUILTIN_KEYS = Object.keys(BUILTIN_SKILLS) as BuiltinSkillKey[];
export const isBuiltinSkill = (v: unknown): v is BuiltinSkillKey => typeof v === "string" && Object.hasOwn(BUILTIN_SKILLS, v);

// ── The workspace's choice ──

export const MAX_CUSTOM_SKILLS = 8;
export const MAX_CRITERIA = 6;
export const SKILL_LABEL_MAX = 60;
export const CRITERION_MAX = 200;

export interface CustomSkill {
  /** "c_" + short random id. */
  id: string;
  label: string;
  dimension: SkillDimension;
  criteria: string[];
}

export interface SkillSettings {
  /** Built-in keys and custom ids that are evaluated. */
  enabled: string[];
  custom: CustomSkill[];
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: BUILTIN_KEYS.filter((k) => (BUILTIN_SKILLS[k] as BuiltIn).on),
  custom: [],
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Stored or sent settings, made valid (unknown keys dropped, limits applied). Null → defaults. */
export function sanitizeSkillSettings(raw: unknown): SkillSettings {
  if (!raw || typeof raw !== "object") return { enabled: [...DEFAULT_SKILL_SETTINGS.enabled], custom: [] };
  const o = raw as Record<string, unknown>;
  const custom: CustomSkill[] = [];
  for (const c of Array.isArray(o.custom) ? o.custom : []) {
    if (!c || typeof c !== "object" || custom.length >= MAX_CUSTOM_SKILLS) continue;
    const r = c as Record<string, unknown>;
    const id = typeof r.id === "string" && /^c_[a-z0-9]{4,16}$/.test(r.id) ? r.id : null;
    const label = clean(r.label, SKILL_LABEL_MAX);
    const criteria = (Array.isArray(r.criteria) ? r.criteria : []).map((x) => clean(x, CRITERION_MAX)).filter(Boolean).slice(0, MAX_CRITERIA);
    if (!id || !label || criteria.length === 0 || custom.some((x) => x.id === id)) continue;
    custom.push({ id, label, dimension: isDimension(r.dimension) ? r.dimension : "cognitiva", criteria });
  }
  const known = new Set<string>([...BUILTIN_KEYS, ...custom.map((c) => c.id)]);
  const enabled = [...new Set((Array.isArray(o.enabled) ? o.enabled : []).filter((k): k is string => typeof k === "string" && known.has(k)))];
  return { enabled, custom };
}

/** Every skill the workspace can evaluate, by dimension (built-in first, then its own). */
export function skillCatalog(settings: SkillSettings): SkillDef[] {
  const all: SkillDef[] = [
    ...BUILTIN_KEYS.map((key) => ({ key, label: BUILTIN_SKILLS[key].label, dimension: BUILTIN_SKILLS[key].dimension as SkillDimension, criteria: [...BUILTIN_SKILLS[key].criteria], custom: false })),
    ...settings.custom.map((c) => ({ key: c.id, label: c.label, dimension: c.dimension, criteria: c.criteria, custom: true })),
  ];
  return DIMENSION_KEYS.flatMap((d) => all.filter((s) => s.dimension === d));
}

/** The skills this workspace evaluates, in catalog order. */
export function enabledSkills(settings: SkillSettings): SkillDef[] {
  const on = new Set(settings.enabled);
  return skillCatalog(settings).filter((s) => on.has(s.key));
}

// ── One work's evaluation ──

export interface SkillAssessment {
  skill: string;
  /** Snapshot: a custom skill may be renamed or removed later. */
  label: string;
  dimension: SkillDimension;
  status: SkillStatus;
  /** The indicator this evidence shows ("" when there is no evidence). */
  criterion: string;
  /** A literal quote of the student ("" when there is no evidence). */
  evidence: string;
  /** Why the quote is evidence of that level. */
  why: string;
  /** What the student could improve. */
  improve: string;
  /** A suggestion to keep developing the skill. */
  suggestion: string;
  /** "teacher" when the teacher corrected the level (kept on a new analysis). */
  source: "ai" | "teacher";
}

/** "Logrado", "en desarrollo", "Sin evidencia" … → the status, or null. */
export function toStatus(v: unknown): SkillStatus | null {
  if (typeof v !== "string") return null;
  const k = v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_");
  if ((SKILL_STATUSES as string[]).includes(k)) return k as SkillStatus;
  if (k.startsWith("sin_evidencia") || k === "no_evaluable" || k === "insuficiente") return "sin_evidencia";
  return null;
}

const LIMITS = { criterion: 300, evidence: 500, why: 600, improve: 500, suggestion: 500 } as const;

/** Stored assessments, made valid (one per skill, known statuses, limits). */
export function sanitizeAssessments(raw: unknown): SkillAssessment[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillAssessment[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const skill = clean(o.skill, 40);
    const status = toStatus(o.status);
    if (!skill || !status || seen.has(skill)) continue;
    seen.add(skill);
    out.push({
      skill,
      label: clean(o.label, SKILL_LABEL_MAX) || skill,
      dimension: isDimension(o.dimension) ? o.dimension : "cognitiva",
      status,
      criterion: clean(o.criterion, LIMITS.criterion),
      evidence: clean(o.evidence, LIMITS.evidence),
      why: clean(o.why, LIMITS.why),
      improve: clean(o.improve, LIMITS.improve),
      suggestion: clean(o.suggestion, LIMITS.suggestion),
      source: o.source === "teacher" ? "teacher" : "ai",
    });
  }
  return out;
}

export const sanitizeRecommendations = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).map((x) => clean(x, 400)).filter(Boolean).slice(0, 4);

// ── Counting ──

export type StatusCounts = Record<SkillStatus | "no_evaluado", number>;
export const emptyCounts = (): StatusCounts => ({ inicial: 0, en_desarrollo: 0, logrado: 0, avanzado: 0, sin_evidencia: 0, no_evaluado: 0 });

/** Students evaluated at some level (sin evidencia and not evaluated are not counted). */
export const evaluatedCount = (c: StatusCounts) => c.inicial + c.en_desarrollo + c.logrado + c.avanzado;
export const goodCount = (c: StatusCounts) => c.logrado + c.avanzado;
export const growCount = (c: StatusCounts) => c.inicial + c.en_desarrollo;

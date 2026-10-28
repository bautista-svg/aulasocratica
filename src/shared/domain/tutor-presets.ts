// Built-in tutors ("Mis tutores"). Every workspace gets an editable copy of each of the 18
// tutor types (presetKey = type key). The values here are the "original" a preset goes back
// to with "Restaurar original". Client-safe (also used to show what changed).
import { TUTOR_FOCUS_TYPES, TUTOR_FORMAT_TYPES, TUTOR_TYPES } from "./pedagogy";
import { TUTOR_TEMPLATES } from "./tutors";

export interface TutorPresetValues {
  name: string;
  tutorType: string;
  subject: string;
  studentAge: string;
  objectives: string;
  questionStyle: string;
  difficulty: "basica" | "intermedia" | "avanzada";
  helpLevel: "autonomous" | "moderate" | "intensive";
  strategies: string;
  closingCriteria: string;
  rules: string;
}

/**
 * Bump when presets are added (not when texts change): workspaces seeded before this date
 * get the missing presets on their next visit. Existing rows are never overwritten.
 */
export const PRESETS_VERSION = "2026-10-28T22:00:00.000Z";

const OBJECTIVES: Record<string, string> = {
  comprension_lectora:
    "Que el estudiante entienda el texto en profundidad: reconozca la idea principal, explique con sus palabras qué quiere decir y señale en qué parte del texto se apoya.",
  matematico:
    "Que el estudiante razone su procedimiento, lo justifique paso a paso y lo ponga a prueba con ejemplos y contraejemplos.",
  pensamiento_critico:
    "Que el estudiante distinga hechos de opiniones, identifique supuestos y evalúe evidencias y puntos de vista antes de concluir.",
  argumentacion: "Que el estudiante sostenga una postura propia con tesis, razones y ejemplos, y responda al menos a una objeción.",
  resolucion_problemas:
    "Que el estudiante identifique datos e incógnita, arme un plan antes de calcular y compruebe si el resultado tiene sentido.",
  investigacion:
    "Que el estudiante formule una pregunta investigable, compare fuentes del material y valore cuáles son confiables.",
  programacion: "Que el estudiante prediga qué hace un programa, explique cada parte y encuentre dónde está la diferencia con lo esperado.",
  metacognicion: "Que el estudiante describa cómo pensó, qué le costó, qué estrategia usó y qué haría distinto.",
  conversacion_personaje:
    "Que el estudiante comprenda una época, un hecho o un punto de vista conversando con un personaje y contrastando lo que dice con el material.",
  conversacion_guiada: "Que el estudiante recorra el tema paso a paso, sin saltearse ninguno, y explique cómo se conectan los pasos.",
  debate_clase: "Que el estudiante tome postura frente a una pregunta polémica, la defienda con razones y considere otras posturas.",
  debate_socratico: "Que el estudiante examine una idea propia frente a objeciones y contraejemplos, y la sostenga o la revise con razones.",
  escritura_mano: "Que el estudiante explique el procedimiento que hizo en papel y revise por su cuenta el paso donde duda.",
  seleccion_multiple: "Que el estudiante elija entre opciones justificando su elección y explicando por qué descarta las demás.",
  repaso: "Que el estudiante recupere lo trabajado y lo explique con sus palabras, de lo más simple a lo más complejo.",
  expresion_oral: "Que el estudiante pueda explicar el tema de forma clara y ordenada, como si lo expusiera frente a la clase.",
  contenido_teorico: "Que el estudiante construya los conceptos del material: los defina con sus palabras, los ejemplifique y los relacione.",
  produccion_escrita: "Que el estudiante planifique, escriba y revise un texto propio que cumpla con la consigna.",
  defensa_autoria: "Que el estudiante explique con sus palabras las partes más complejas de su trabajo: qué hacen, por qué las eligió y qué pasaría si las cambiara.",
};

const HELP: Partial<Record<string, TutorPresetValues["helpLevel"]>> = {
  debate_socratico: "autonomous",
  contenido_teorico: "intensive",
  defensa_autoria: "autonomous",
};

/** Keys in display order: focus types first, then formats. */
export const PRESET_KEYS: string[] = [...Object.keys(TUTOR_FOCUS_TYPES), ...Object.keys(TUTOR_FORMAT_TYPES)];

export function presetValues(key: string): TutorPresetValues | null {
  if (!(key in TUTOR_TYPES)) return null;
  const t = TUTOR_TEMPLATES[key];
  return {
    name: TUTOR_TYPES[key]!,
    tutorType: key,
    subject: "",
    studentAge: "",
    objectives: OBJECTIVES[key] ?? "",
    questionStyle: t?.question_style ?? "",
    difficulty: "intermedia",
    helpLevel: HELP[key] ?? "moderate",
    strategies: t?.strategies ?? "",
    closingCriteria: t?.closing_criteria ?? "",
    rules: "",
  };
}

export const TUTOR_PRESETS: { key: string; values: TutorPresetValues }[] = PRESET_KEYS.map((key) => ({ key, values: presetValues(key)! }));

/** "focus" | "format" for a tutor type key (custom tutors are grouped by their type too). */
export function tutorGroup(type: string): "focus" | "format" {
  return type in TUTOR_FOCUS_TYPES ? "focus" : "format";
}

const EDITABLE: (keyof TutorPresetValues)[] = [
  "name",
  "tutorType",
  "subject",
  "studentAge",
  "objectives",
  "questionStyle",
  "difficulty",
  "helpLevel",
  "strategies",
  "closingCriteria",
  "rules",
];

/** True when the values are exactly the preset's original ones (after trimming). */
export function matchesPreset(key: string, v: Partial<Record<keyof TutorPresetValues, string>>): boolean {
  const p = presetValues(key);
  if (!p) return false;
  return EDITABLE.every((f) => String(v[f] ?? "").trim() === String(p[f]).trim());
}

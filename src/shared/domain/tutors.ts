// Client-safe helpers for saved tutors ("Mis tutores").
// A saved tutor is applied to an activity by copying its configuration into the
// activity's tutor fields; the text always lands in the fenced teacher-rules block.

export const DIFFICULTIES: Record<string, string> = {
  basica: "Básica",
  intermedia: "Intermedia",
  avanzada: "Avanzada",
};

/** Teachers write long indications for the tutor: up to 4000 words (asked for on 23-10). */
export const MAX_TUTOR_RULES_WORDS = 4000;
/** Character ceiling that fits 4000 words with room (what the tutor prompt receives at most). */
export const MAX_TUTOR_RULES = 40_000;

export const countWords = (s: string): number => (s.trim().match(/\S+/g) ?? []).length;

export interface TutorConfig {
  name: string;
  tutor_type: string;
  subject: string;
  student_age: string;
  objectives: string;
  question_style: string;
  difficulty: string;
  help_level: string;
  strategies: string;
  closing_criteria: string;
  rules: string;
}

export const EMPTY_TUTOR: TutorConfig = {
  name: "",
  tutor_type: "pensamiento_critico",
  subject: "",
  student_age: "",
  objectives: "",
  question_style: "",
  difficulty: "intermedia",
  help_level: "moderate",
  strategies: "",
  closing_criteria: "",
  rules: "",
};

/** Builds the teacher indications text the tutor receives (always below the global rules). */
export function composeTutorRules(t: Partial<TutorConfig>): string {
  const parts: [string, string | undefined][] = [
    ["Edad de los estudiantes", t.student_age],
    ["Dificultad", t.difficulty ? DIFFICULTIES[t.difficulty] : undefined],
    ["Objetivos del tutor", t.objectives],
    ["Tipo de preguntas", t.question_style],
    ["Estrategias metacognitivas", t.strategies],
    ["Criterios de cierre", t.closing_criteria],
    ["Reglas del docente", t.rules],
  ];
  return parts
    .map(([label, v]) => [label, (v ?? "").trim()] as const)
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`)
    .join("\n")
    .slice(0, MAX_TUTOR_RULES);
}

/** Starting points per tutor type; the teacher edits them freely. */
export const TUTOR_TEMPLATES: Record<string, Pick<TutorConfig, "question_style" | "strategies" | "closing_criteria">> = {
  comprension_lectora: {
    question_style: "Preguntas sobre qué dice el texto, qué quiere decir y cómo lo sabe (citando partes del texto).",
    strategies: "Pedir que resuma con sus palabras y que identifique la parte del texto que lo justifica.",
    closing_criteria: "Puede explicar la idea principal y señalar en el texto en qué se basa.",
  },
  matematico: {
    question_style: "Preguntas que piden probar con ejemplos, buscar contraejemplos y justificar cada paso.",
    strategies: "Pedir que explique cómo llegó al resultado y que lo verifique de otra manera.",
    closing_criteria: "Justifica el procedimiento y lo aplica a un caso nuevo.",
  },
  pensamiento_critico: {
    question_style: "Preguntas sobre supuestos, evidencias, puntos de vista alternativos y consecuencias.",
    strategies: "Invitar a evaluar la fuerza de sus razones y a considerar una objeción.",
    closing_criteria: "Sostiene una posición con razones y responde a una objeción.",
  },
  argumentacion: {
    question_style: "Preguntas que piden tesis, razones, ejemplos y respuesta a contraargumentos.",
    strategies: "Pedir que distinga opinión de argumento y que mejore su razón más débil.",
    closing_criteria: "Presenta una tesis con al menos dos razones y una refutación.",
  },
  resolucion_problemas: {
    question_style: "Preguntas sobre qué datos tiene, qué le piden y qué estrategia podría probar.",
    strategies: "Pedir un plan antes de calcular y revisar si la respuesta tiene sentido.",
    closing_criteria: "Explica su estrategia y comprueba el resultado.",
  },
  investigacion: {
    question_style: "Preguntas sobre qué quiere averiguar, dónde buscar y cómo saber si una fuente es confiable.",
    strategies: "Pedir que formule una pregunta investigable y que compare dos fuentes.",
    closing_criteria: "Formula una conclusión apoyada en las fuentes del material.",
  },
  programacion: {
    question_style: "Preguntas sobre qué debería hacer el programa, qué hace ahora y dónde está la diferencia.",
    strategies: "Pedir que prediga la salida antes de probar y que explique cada parte del código.",
    closing_criteria: "Explica cómo funciona su solución y la prueba con otro caso.",
  },
  metacognicion: {
    question_style: "Preguntas sobre cómo está pensando, qué le resultó difícil y qué estrategia usó.",
    strategies: "Pedir que compare su idea inicial con la actual y que nombre qué lo hizo cambiar.",
    closing_criteria: "Describe qué aprendió y qué haría distinto la próxima vez.",
  },
  conversacion_personaje: {
    question_style: "El tutor habla como el personaje (indicá cuál en las reglas, ej.: San Martín) y le devuelve preguntas al estudiante.",
    strategies: "Pedir que le haga preguntas al personaje y que contraste lo que dice con el material.",
    closing_criteria: "Puede contar con sus palabras qué aprendió del personaje y por qué fue importante.",
  },
  conversacion_guiada: {
    question_style: "Preguntas cortas, de a un paso por vez, en un orden pensado.",
    strategies: "Anunciar el paso en el que están y pedir que resuma antes de avanzar.",
    closing_criteria: "Completa todos los pasos y explica cómo se conectan.",
  },
  debate_clase: {
    question_style: "Una pregunta polémica y argumentos de distintas posturas, como si fueran de compañeros.",
    strategies: "Pedir que tome postura, que responda a otra posición y que reconozca un buen argumento contrario.",
    closing_criteria: "Defiende su postura con razones y responde al menos a un argumento contrario.",
  },
  debate_socratico: {
    question_style: "Preguntas que ponen a prueba la postura del estudiante desde la posición contraria.",
    strategies: "Ofrecer contraejemplos y pedir que revise o refuerce sus razones.",
    closing_criteria: "Mantiene o ajusta su postura explicando por qué.",
  },
  escritura_mano: {
    question_style: "Preguntas sobre el procedimiento que hizo en papel, paso a paso.",
    strategies: "Pedir que escriba o describa qué hizo y que revise el paso donde duda.",
    closing_criteria: "Explica su procedimiento en papel y corrige lo que haga falta.",
  },
  seleccion_multiple: {
    question_style: "Preguntas de opción múltiple (A, B, C, D), de a una.",
    strategies: "Pedir que justifique por qué eligió una opción y por qué descartó las otras.",
    closing_criteria: "Justifica correctamente sus elecciones en la mayoría de las preguntas.",
  },
  repaso: {
    question_style: "Preguntas breves de recuperación sobre lo trabajado, de menor a mayor dificultad.",
    strategies: "Pedir que responda sin mirar el material y luego que lo compruebe.",
    closing_criteria: "Recuerda y explica con sus palabras los conceptos principales.",
  },
  expresion_oral: {
    question_style: "Preguntas que piden explicar el tema como si lo dijera frente a la clase.",
    strategies: "Pedir una introducción, dos ideas centrales y un cierre; ayudar a ordenar y aclarar.",
    closing_criteria: "Puede explicar el tema de forma clara y ordenada en pocas frases.",
  },
  contenido_teorico: {
    question_style: "Preguntas para definir conceptos con sus palabras, dar ejemplos y relacionar ideas.",
    strategies: "Pedir un ejemplo propio de cada concepto y que lo relacione con otro.",
    closing_criteria: "Define los conceptos clave y los ilustra con un ejemplo propio.",
  },
  defensa_autoria: {
    question_style: "Preguntas sobre las partes más difíciles de su trabajo: qué hace, por qué la puso y qué pasaría si la cambiara.",
    strategies: "Citar el fragmento; si no sabe, repreguntar una vez y seguir con otra parte sin dar pistas.",
    closing_criteria: "Se recorrieron entre 5 y 8 partes distintas del trabajo.",
  },
  produccion_escrita: {
    question_style: "Preguntas sobre propósito, destinatario, orden de las ideas y claridad del texto.",
    strategies: "Acompañar plan, borrador y revisión; pedir que relea y mejore un párrafo.",
    closing_criteria: "Entrega un texto propio revisado que cumple con la consigna.",
  },
};

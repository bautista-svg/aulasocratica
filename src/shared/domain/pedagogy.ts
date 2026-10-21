// Client-safe pedagogical vocabulary shared by the student and teacher views.

export const STUDENT_INTENTS = {
  hint: { label: "Necesito una pista", message: "Necesito una pista.", event: "hint_requested" },
  not_understood: { label: "No entendí", message: "No entendí.", event: "clarification_requested" },
  example: { label: "¿Podés darme un ejemplo?", message: "¿Podés darme un ejemplo?", event: "example_requested" },
  review: { label: "Quiero revisar mi respuesta", message: "Quiero revisar mi respuesta.", event: "review_requested" },
  other_idea: { label: "Tengo otra idea", message: "Tengo otra idea:", event: "alternative_idea" },
  explain: { label: "Quiero explicar lo que aprendí", message: "Quiero explicar lo que aprendí:", event: "explanation_offered" },
} as const;

export type StudentIntent = keyof typeof STUDENT_INTENTS;

export const EVENT_LABELS: Record<string, string> = {
  session_entered: "Ingresó a la actividad",
  initial_answer_saved: "Escribió su respuesta inicial",
  message_sent: "Respondió al tutor",
  hint_requested: "Solicitó una pista",
  clarification_requested: "Indicó que no entendió",
  example_requested: "Pidió un ejemplo",
  review_requested: "Pidió revisar su respuesta",
  alternative_idea: "Propuso otra idea",
  explanation_offered: "Explicó lo que aprendió",
  closing_started: "Empezó a escribir su respuesta final",
  final_answer_saved: "Escribió su respuesta final",
  reformulated: "Reformuló su respuesta",
  reflection_submitted: "Completó la reflexión",
  activity_completed: "Finalizó la actividad",
  ended_by_teacher: "El docente cerró la actividad",
  pasted_text: "Pegó texto copiado fuera de la actividad",
  left_app: "Salió de la actividad (otra pestaña o aplicación)",
  voice_message: "Habló con el tutor por audio",
};

/** Tutor focus (what kind of thinking it trains). */
export const TUTOR_FOCUS_TYPES: Record<string, string> = {
  comprension_lectora: "Comprensión lectora",
  matematico: "Matemático",
  pensamiento_critico: "Pensamiento crítico",
  argumentacion: "Argumentación",
  resolucion_problemas: "Resolución de problemas",
  investigacion: "Investigación",
  programacion: "Programación",
  metacognicion: "Metacognición",
};

/** Tutor format (how the activity runs). */
export const TUTOR_FORMAT_TYPES: Record<string, string> = {
  conversacion_personaje: "Conversación con personaje",
  conversacion_guiada: "Conversación guiada",
  debate_clase: "Debate de clase",
  debate_socratico: "Debate socrático",
  escritura_mano: "Escritura a mano",
  seleccion_multiple: "Selección múltiple",
  repaso: "Repaso",
  expresion_oral: "Expresión oral",
  contenido_teorico: "Contenido teórico",
  produccion_escrita: "Producción escrita",
};

export const TUTOR_TYPES: Record<string, string> = { ...TUTOR_FOCUS_TYPES, ...TUTOR_FORMAT_TYPES };

/** Teacher-facing explanation of each type, shown when choosing it. */
export const TUTOR_TYPE_INFO: Record<string, { description: string; whenToUse: string }> = {
  conversacion_guiada: {
    description: "Diálogo abierto con un agente que guía al estudiante hacia los objetivos del aprendizaje.",
    whenToUse: "Elegila cuando importa más el razonamiento que la respuesta y el tema no tiene una única solución correcta.",
  },
  contenido_teorico: {
    description: "Diálogo guiado sobre un texto que vos aportás: el estudiante lo lee y después lo piensa en voz alta.",
    whenToUse: "Elegila cuando el material es tuyo y querés saber cómo cayó.",
  },
  conversacion_personaje: {
    description: "Conversación en rol: el agente interpreta a un personaje definido con propósito pedagógico.",
    whenToUse: "Elegila cuando la perspectiva es la clase: un momento histórico, una decisión profesional, un punto de vista que vale la pena habitar.",
  },
  repaso: {
    description: "Repaso conversacional: la IA recorre preguntas simples de a una para chequear qué quedó del tema.",
    whenToUse: "Elegilo después de enseñar un tema y antes de evaluarlo.",
  },
  debate_clase: {
    description: "Fomenta el pensamiento crítico con temas de argumentación estructurados según tu materia.",
    whenToUse: "Elegilo para temas con posiciones enfrentadas legítimas y sustancia suficiente para discutir.",
  },
  debate_socratico: {
    description: "Diálogo de preguntas socráticas que guía al estudiante a examinar y justificar sus ideas.",
    whenToUse: "Elegilo cuando el estudiante ya sostiene una creencia que vale la pena examinar y aprende más cuestionándola que defendiéndola.",
  },
  seleccion_multiple: {
    description: "Evaluación rápida o preparación para exámenes con opción múltiple, emparejamiento y completar espacios.",
    whenToUse: "Elegilo cuando necesitás una lectura rápida y comparable de todo el grupo.",
  },
  produccion_escrita: {
    description: "Consigna clara de producción escrita con rúbrica de evaluación explícita.",
    whenToUse: "Elegila cuando lo que te importa es el argumento y su estructura.",
  },
  escritura_mano: {
    description: "Actividad de captura y análisis de escritura manuscrita.",
    whenToUse: "Elegila en alfabetización y numeración iniciales, o cada vez que lo que evaluás es el proceso en papel.",
  },
  expresion_oral: {
    description: "Práctica y evaluación de la expresión oral del estudiante.",
    whenToUse: "Elegila para práctica de idioma, defensa oral, o cualquier objetivo donde la fluidez y la exposición sean parte de lo que se aprende.",
  },
  comprension_lectora: {
    description: "Acompaña la lectura con preguntas sobre qué dice el texto, qué quiere decir y en qué parte se apoya cada idea.",
    whenToUse: "Elegilo cuando el objetivo es entender un texto en profundidad, no solo encontrar datos.",
  },
  matematico: {
    description: "Diálogo para razonar en matemática: probar con ejemplos, buscar contraejemplos y justificar cada paso.",
    whenToUse: "Elegilo cuando importa el procedimiento y la justificación más que el resultado.",
  },
  pensamiento_critico: {
    description: "Trabaja supuestos, evidencias, puntos de vista alternativos y consecuencias.",
    whenToUse: "Elegilo cuando el tema invita a cuestionar fuentes, opiniones o información.",
  },
  argumentacion: {
    description: "Ayuda a construir una postura propia con tesis, razones, ejemplos y respuesta a las objeciones.",
    whenToUse: "Elegilo cuando querés que el estudiante defienda una idea, por escrito u oralmente.",
  },
  resolucion_problemas: {
    description: "Guía a identificar datos e incógnita y a armar un plan antes de resolver.",
    whenToUse: "Elegilo para problemas de varios pasos, cuando los chicos se apuran a calcular sin entender.",
  },
  investigacion: {
    description: "Acompaña a formular preguntas investigables y a valorar la confiabilidad de las fuentes.",
    whenToUse: "Elegilo en proyectos o trabajos que piden buscar y seleccionar información.",
  },
  programacion: {
    description: "Pide predecir qué hace el código antes de probarlo y explicar cada parte.",
    whenToUse: "Elegilo para aprender a programar entendiendo, no copiando código.",
  },
  metacognicion: {
    description: "Invita a pensar cómo está pensando: qué le costó, qué estrategia usó y qué cambiaría.",
    whenToUse: "Elegilo al cierre de una unidad o cuando querés que el estudiante revise su forma de aprender.",
  },
};

/** How the tutor behaves for each type. Always inside the global Socratic rules. */
export const TUTOR_TYPE_GUIDANCE: Record<string, string> = {
  comprension_lectora: "Ayudá a entender el texto: qué dice, qué quiere decir y en qué parte se apoya cada idea.",
  matematico: "Pedí que pruebe con ejemplos, busque contraejemplos y justifique cada paso.",
  pensamiento_critico: "Trabajá supuestos, evidencias, puntos de vista alternativos y consecuencias.",
  argumentacion: "Pedí tesis, razones, ejemplos y respuesta a contraargumentos.",
  resolucion_problemas: "Pedí que identifique datos e incógnita y que arme un plan antes de calcular.",
  investigacion: "Ayudá a formular preguntas investigables y a valorar la confiabilidad de las fuentes.",
  programacion: "Pedí que prediga qué hace el código antes de probarlo y que explique cada parte.",
  metacognicion: "Invitá a pensar cómo está pensando, qué le costó y qué estrategia usó.",
  conversacion_personaje:
    "Interpretá al personaje que indica el docente (si no indica ninguno, uno relacionado con la actividad), hablando en primera persona y con datos fieles al material. Seguí haciendo preguntas: el personaje no da las respuestas de la consigna. Si el estudiante pregunta algo que el personaje no podría saber, decilo.",
  conversacion_guiada: "Llevá la charla por pasos cortos y en orden, anunciando en qué paso están; avanzá solo cuando el estudiante resolvió el anterior.",
  debate_clase:
    "Planteá una pregunta polémica de la actividad y pedí que tome postura. Presentá argumentos de otras posturas como si fueran de compañeros, sin decir cuál es la correcta.",
  debate_socratico: "Debatí tomando la postura contraria a la del estudiante con preguntas y contraejemplos, para que fortalezca o revise sus razones.",
  escritura_mano:
    "El estudiante resuelve en papel. Pedile que escriba acá lo que hizo (o lo describa paso a paso) y hacé preguntas sobre su procedimiento, sin pedirle que reescriba todo.",
  seleccion_multiple:
    "Proponé preguntas de opción múltiple (A, B, C, D) sobre el contenido, de a una. No digas cuál es la correcta: pedí que justifique su elección y, si se equivoca, preguntá por qué descartó las otras.",
  repaso: "Hacé preguntas breves de recuperación sobre lo ya trabajado, aumentando la dificultad de a poco, y pedí que explique con sus palabras.",
  expresion_oral:
    "Prepará al estudiante para explicar el tema en voz alta: pedí respuestas como si las dijera frente a la clase, con frases claras y ordenadas, y ayudalo a mejorar la organización de sus ideas.",
  contenido_teorico:
    "Ayudá a construir los conceptos del material con preguntas: definiciones con sus palabras, ejemplos propios y relaciones entre ideas. Podés explicar brevemente un concepto del material si está bloqueado, pero nunca resolver la consigna.",
  produccion_escrita:
    "Acompañá la escritura de un texto propio: planificación, borrador y revisión. Hacé preguntas sobre propósito, destinatario, orden de las ideas y claridad; no escribas el texto por el estudiante.",
};

export const HELP_LEVELS: Record<string, { label: string; description: string }> = {
  autonomous: { label: "Exploración autónoma", description: "Preguntas abiertas, pistas mínimas." },
  moderate: { label: "Andamiaje moderado", description: "Pistas graduadas cuando el alumno se bloquea." },
  intensive: { label: "Andamiaje intensivo", description: "Ejemplos trabajados y explicaciones breves si es necesario." },
};

export const REFLECTION_QUESTIONS = [
  { key: "start", question: "¿Qué pensabas al comenzar?" },
  { key: "discovered", question: "¿Qué descubriste durante la actividad?" },
  { key: "helpful", question: "¿Qué pregunta te ayudó más?" },
  { key: "changed", question: "¿Qué cambiaste de tu respuesta?" },
  { key: "now", question: "¿Qué podrías resolver ahora sin ayuda?" },
] as const;

export const SESSION_STATUS_LABELS: Record<string, string> = {
  not_started: "No ingresó",
  in_progress: "En curso",
  completed: "Finalizó",
};

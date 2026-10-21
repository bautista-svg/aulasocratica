// Client-safe vocabulary for the "Crear clase con IA" wizard.

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

export const WIZARD_STEPS = [
  "Información de la clase",
  "Materiales",
  "Habilidades",
  "Propuestas de la IA",
  "Tutor",
  "Revisar y publicar",
] as const;

export interface ClassProposal {
  activityType: string;
  title: string;
  instructions: string;
  objectives: string;
  teacherNotes: string;
  tutorType: string;
  helpLevel: string;
  tutorGuidance: string;
  reflectionQuestions: string[];
}

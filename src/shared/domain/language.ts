// The language an activity runs in for its students ("es" or "en"). The teacher's screens stay in
// Spanish; the student's screens, the help buttons, the default reflection and closing questions
// and the tutor's replies follow the activity's language.
import { STUDENT_INTENTS, type StudentIntent } from "./pedagogy";
import { DEFAULT_REFLECTION_QUESTIONS, type ReflectionQuestion } from "./activity-design";

export type ActivityLanguage = "es" | "en";
export const ACTIVITY_LANGUAGES: Record<ActivityLanguage, string> = { es: "Castellano", en: "English" };
export const isActivityLanguage = (v: unknown): v is ActivityLanguage => v === "es" || v === "en";
export const languageOf = (v: unknown): ActivityLanguage => (isActivityLanguage(v) ? v : "es");

const INTENTS_EN: Record<StudentIntent, { label: string; message: string }> = {
  hint: { label: "I need a hint", message: "I need a hint." },
  not_understood: { label: "I didn't understand", message: "I didn't understand." },
  example: { label: "Can you give me an example?", message: "Can you give me an example?" },
  review: { label: "I want to check my answer", message: "I want to check my answer." },
  other_idea: { label: "I have another idea", message: "I have another idea:" },
  explain: { label: "I want to explain what I learned", message: "I want to explain what I learned:" },
};

/** Label and message of a help button in the activity's language. */
export function intentText(intent: StudentIntent, lang: ActivityLanguage): { label: string; message: string } {
  return lang === "en" ? INTENTS_EN[intent] : { label: STUDENT_INTENTS[intent].label, message: STUDENT_INTENTS[intent].message };
}

/** How a button's message can start, in any language (to tell it from the student's own words). */
export function intentMessages(intent: StudentIntent): string[] {
  return [STUDENT_INTENTS[intent].message, INTENTS_EN[intent].message];
}

const REFLECTION_EN: Record<string, string> = {
  discovered: "What did you discover during the activity?",
  changed: "What did you change in your answer, and why?",
};

/** The default reflection questions read in English when the teacher kept them as they were. */
export function reflectionQuestionsIn(questions: ReflectionQuestion[], lang: ActivityLanguage): ReflectionQuestion[] {
  if (lang !== "en") return questions;
  const defaults = new Map(DEFAULT_REFLECTION_QUESTIONS.map((q) => [q.key, q.question]));
  return questions.map((q) => (defaults.get(q.key) === q.question && REFLECTION_EN[q.key] ? { ...q, question: REFLECTION_EN[q.key]! } : q));
}

export const DEFAULT_FINAL_QUESTION_BY_LANGUAGE: Record<ActivityLanguage, string> = {
  es: "¿Qué pensás ahora?",
  en: "What do you think now?",
};

export const LINK_AVAILABILITY_MESSAGE_EN = {
  inactive: "Your teacher closed this activity for now.",
  not_started: "This activity hasn't started yet.",
  expired: "This activity has ended.",
  unpublished: "This activity isn't published yet.",
  archived: "This activity is no longer available.",
} as const;

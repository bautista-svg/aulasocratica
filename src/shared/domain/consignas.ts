// An activity can ask for several consignas, solved in order with the same tutor (teachers asked
// for a "+" to add them). The first one is `activities.instructions`; the others live in
// `activities.more_instructions`. With several, the student writes one final answer per consigna
// (`learning_sessions.final_answers`) and `final_answer` keeps them joined with their numbers, so
// everything that reads the final answer (AI analyses, reports, live view) sees all of them.

export const MAX_CONSIGNAS = 8;

/** The closing question; the teacher can rewrite it or not ask for a final answer at all. */
export const DEFAULT_FINAL_QUESTION = "¿Qué pensás ahora?";
export const FINAL_QUESTION_MAX = 160;

/** The extra consignas as stored: trimmed, non-empty, at most MAX_CONSIGNAS - 1. */
export function sanitizeMoreInstructions(raw: unknown, maxChars: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().slice(0, maxChars))
    .filter(Boolean)
    .slice(0, MAX_CONSIGNAS - 1);
}

/** Every consigna of an activity, in order (empty ones left out). */
export function consignasOf(a: { instructions: string; moreInstructions?: unknown }): string[] {
  return [a.instructions.trim(), ...sanitizeMoreInstructions(a.moreInstructions, 100_000)].filter(Boolean);
}

/** The per-consigna answers stored with a work ([] for single-consigna works). */
export function readFinalAnswers(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((a) => (typeof a === "string" ? a : "")) : [];
}

/** One text with every answer under its consigna number (what the AI and the reports read). */
export function joinFinalAnswers(answers: string[]): string {
  if (answers.length <= 1) return (answers[0] ?? "").trim();
  return answers.map((a, i) => `Consigna ${i + 1}:\n${a.trim()}`).join("\n\n");
}

// Limits of the student API that the student page also needs at runtime. They live apart from the
// zod schemas in student.ts (which re-exports them) so the student page does not download zod just
// to read a few numbers.
export const MAX_CHAT_CHARS = 3000;
export const MIN_ANSWER_CHARS = 3;
export const MAX_ANSWER_CHARS = 4000;
export const MAX_REFLECTION_ANSWER_CHARS = 2000;
export const RESUME_CODE_LENGTH = 6;

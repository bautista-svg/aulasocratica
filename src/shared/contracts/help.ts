// "¿Dónde está…?": the teacher asks where something is; the AI answers in a sentence or two and
// names one place of the app (shared/domain/help-places.ts) that the client takes them to.
import { z } from "zod";

export const HELP_QUESTION_MAX = 500;

export const helpAskBody = z.object({
  question: z.string().trim().min(2, "Escribí qué estás buscando.").max(HELP_QUESTION_MAX, `Usá hasta ${HELP_QUESTION_MAX} caracteres.`),
  /** The screen the teacher is on, so "acá" and scoped places make sense. */
  path: z.string().max(200).default("/app"),
  /** The last turns of this conversation (kept in the browser, not stored). */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1200) }))
    .max(6)
    .default([]),
});
export type HelpAskBody = z.input<typeof helpAskBody>;

export interface HelpAnswer {
  answer: string;
  /** A place id from HELP_PLACES, or null when the answer is not about a place. */
  placeId: string | null;
}

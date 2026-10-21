// Limits of the student API that the student page also needs at runtime. They live apart from the
// zod schemas in student.ts (which re-exports them) so the student page does not download zod just
// to read a few numbers (and the pure helpers for the resume code and the activity line).
export const MAX_CHAT_CHARS = 3000;
export const MIN_ANSWER_CHARS = 3;
export const MAX_ANSWER_CHARS = 4000;
export const MAX_REFLECTION_ANSWER_CHARS = 2000;
export const RESUME_CODE_LENGTH = 6;
/** Characters of a resume code: the server's humanCode alphabet (no 0/O/1/I, easy to read aloud). */
export const RESUME_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "k7m-2qx" → "K7M2QX" (spaces and dashes are only for reading). */
export function normalizeResumeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Why a typed code cannot be a resume code, or null when its format is right. Checked in the
 * form before sending and again on the server, where a malformed code never counts as an attempt.
 */
export function resumeCodeProblem(raw: string): string | null {
  const code = normalizeResumeCode(raw);
  if (!code) return "Escribí tu código.";
  const missing = RESUME_CODE_LENGTH - code.length;
  if (missing > 0) return `${missing === 1 ? "Falta 1 letra o número" : `Faltan ${missing} letras o números`}: el código tiene 6.`;
  if (missing < 0) return "Sobran letras o números: el código tiene 6.";
  if ([...code].some((ch) => !RESUME_CODE_ALPHABET.includes(ch))) {
    return "Revisá el código: nunca lleva 0, O, 1 ni I.";
  }
  return null;
}

/**
 * Joins the parts of the "materia · curso · escuela" line without repeating what an earlier or
 * later part already says ("Ciencias Naturales" inside "5.º B — Ciencias Naturales", "5.º grado B"
 * next to "5.º B").
 */
export function studentMetaLine(parts: (string | null | undefined)[]): string {
  const kept: { text: string; words: Set<string> }[] = [];
  const covers = (big: Set<string>, small: Set<string>) => small.size > 0 && [...small].every((w) => big.has(w));
  for (const raw of parts) {
    const text = (raw ?? "").trim();
    if (!text) continue;
    const words = metaWords(text);
    const union = new Set(kept.flatMap((k) => [...k.words]));
    if (covers(union, words) || kept.some((k) => k.text === text)) continue;
    for (let i = kept.length - 1; i >= 0; i--) if (covers(words, kept[i]!.words)) kept.splice(i, 1);
    kept.push({ text, words });
  }
  return kept.map((k) => k.text).join(" · ");
}

const META_FILLER = new Set(["grado", "ano", "anio", "division", "seccion", "curso", "de", "del", "la", "el", "los", "las", "y"]);

function metaWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !META_FILLER.has(w)),
  );
}

// «Defensa de código»: the tutor shows a student a fragment of their own code and asks what it
// means, what it does, or what would happen if something changed. The student never needs the code
// at hand: the AI only names the lines and the server cuts them from the real files, so what is on
// screen is always the student's code, word for word. This shows how well they can explain the
// work; it does not prove who wrote it, and the screens say so.

export const CODE_LIMITS = { files: 12, fileChars: 60_000, totalChars: 120_000, nameChars: 120 } as const;
/** The whole defense: fragments to go through, and most messages the tutor writes. */
export const DEFENSE_FRAGMENTS = { min: 5, max: 8 } as const;
export const DEFENSE_MAX_MESSAGES = 14;
/** Answers needed before the tutor may close, and before the result says anything. */
export const DEFENSE_MIN_ANSWERS = 2;
export const DEFENSE_CONCLUSIVE_ANSWERS = 3;
export const FRAGMENT_MAX_LINES = 14;
const FRAGMENT_MAX_CHARS = 1400;

export const CODE_ACCEPT = ".html,.htm,.css,.scss,.js,.jsx,.ts,.tsx,.vue,.svelte,.json,.php,.py,.java,.c,.cpp,.cs,.sql,.md,.txt,.xml,.svg";

export interface CodeFile {
  name: string;
  text: string;
}

export function isCodeDefense(a: { tutorType: string; extraTutorTypes?: unknown }): boolean {
  if (a.tutorType === "defensa_autoria") return true;
  return Array.isArray(a.extraTutorTypes) && a.extraTutorTypes.includes("defensa_autoria");
}

const safeName = (name: string) =>
  name
    .replace(/[\\/]+/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/")
    // The name travels in the first line of a code fence.
    .replace(/[\s`:]+/g, "_")
    .slice(-CODE_LIMITS.nameChars);

/** The files to keep, or what is wrong with them (in the words the person reads). */
export function cleanCodeFiles(raw: readonly CodeFile[]): { files: CodeFile[]; error: string | null } {
  const files: CodeFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of raw) {
    const text = f.text.replace(/\r\n/g, "\n");
    if (!text.trim()) continue;
    if (text.includes("\u0000")) return { files: [], error: `«${safeName(f.name) || "Ese archivo"}» no es de texto. Subí archivos de código, como .html, .css o .js.` };
    if (text.length > CODE_LIMITS.fileChars) return { files: [], error: `«${safeName(f.name)}» es demasiado largo. Subí solo el código que escribiste, sin librerías.` };
    let name = safeName(f.name) || `codigo-${files.length + 1}.txt`;
    if (seen.has(name)) name = `${files.length + 1}-${name}`;
    seen.add(name);
    total += text.length;
    files.push({ name, text });
  }
  if (!files.length) return { files: [], error: "Pegá tu código o subí al menos un archivo." };
  if (files.length > CODE_LIMITS.files) return { files: [], error: `Subí hasta ${CODE_LIMITS.files} archivos.` };
  if (total > CODE_LIMITS.totalChars) return { files: [], error: "Es demasiado código. Subí solo lo que escribiste, sin librerías." };
  return { files, error: null };
}

const linesOf = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
export const lineCount = (text: string) => linesOf(text).length;

export interface CodeFragment {
  file: string;
  fromLine: number;
  toLine: number;
  code: string;
}

/** The lines the AI named, cut from the real file. Null when they do not exist or say nothing. */
export function cutFragment(files: readonly CodeFile[], file: string, from: number, to: number): CodeFragment | null {
  const wanted = file.trim().toLowerCase();
  const f = files.find((x) => x.name.toLowerCase() === wanted) ?? files.find((x) => x.name.toLowerCase().endsWith(`/${wanted}`));
  if (!f || !Number.isInteger(from) || !Number.isInteger(to)) return null;
  const lines = linesOf(f.text);
  let start = Math.max(1, from);
  let end = Math.min(lines.length, to, start + FRAGMENT_MAX_LINES - 1);
  if (end < start) return null;
  while (start < end && !lines[start - 1]!.trim()) start++;
  while (end > start && !lines[end - 1]!.trim()) end--;
  const picked = lines.slice(start - 1, end);
  if (!picked.join("").trim()) return null;
  // Minified code is one enormous line: what fits on screen is enough to talk about it.
  const code = picked.join("\n");
  return { file: f.name, fromLine: start, toLine: end, code: code.length > FRAGMENT_MAX_CHARS ? `${code.slice(0, FRAGMENT_MAX_CHARS)}…` : code };
}

/** The change only counts if it starts from something that is really in the fragment. */
export function validChange(fragment: CodeFragment, change: { before: string; after: string } | null): { before: string; after: string } | null {
  if (!change) return null;
  const before = change.before.trim();
  const after = change.after.trim();
  if (!before || before === after || !fragment.code.includes(before)) return null;
  return { before, after };
}

export function codeLanguage(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

const fenceFor = (code: string) => "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** The fragment as it goes in the message: "```css estilos.css:12". The student's screen draws it. */
export function fragmentMarkdown(f: CodeFragment): string {
  const fence = fenceFor(f.code);
  return `${fence}${codeLanguage(f.file) || "text"} ${f.file}:${f.fromLine}\n${f.code}\n${fence}`;
}

export function changeMarkdown(file: string, change: { before: string; after: string }): string {
  const lines = (prefix: string, s: string) => s.split("\n").map((l) => `${prefix} ${l}`).join("\n");
  const body = `${lines("-", change.before)}\n${lines("+", change.after)}`;
  const fence = fenceFor(body);
  return `${fence}diff ${file}\n${body}\n${fence}`;
}

// ── The result the teacher reads ──

export type DefenseVerdict = "explained" | "partial" | "not_explained";
export type DefenseBand = "explains" | "partly" | "struggles" | "pending";

export const VERDICT_LABELS: Record<DefenseVerdict, string> = {
  explained: "Lo explicó",
  partial: "En parte",
  not_explained: "No pudo explicarlo",
};

export const BAND_LABELS: Record<DefenseBand, string> = {
  explains: "Explica su código",
  partly: "Lo explica en parte",
  struggles: "Le cuesta explicarlo",
  pending: "Todavía sin resultado",
};

export const QUESTION_KINDS = ["meaning", "behavior", "change", "why", "predict"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  meaning: "Qué significa",
  behavior: "Qué hace",
  change: "Qué pasa si cambia",
  why: "Por qué así",
  predict: "Qué va a pasar",
};

export function defenseResult(verdicts: readonly (DefenseVerdict | null)[]): {
  explained: number;
  partial: number;
  notExplained: number;
  answered: number;
  band: DefenseBand;
} {
  const count = (v: DefenseVerdict) => verdicts.filter((x) => x === v).length;
  const explained = count("explained");
  const partial = count("partial");
  const notExplained = count("not_explained");
  const answered = explained + partial + notExplained;
  if (answered < DEFENSE_CONCLUSIVE_ANSWERS) return { explained, partial, notExplained, answered, band: "pending" };
  const score = (explained + partial / 2) / answered;
  return { explained, partial, notExplained, answered, band: score >= 0.75 ? "explains" : score >= 0.4 ? "partly" : "struggles" };
}

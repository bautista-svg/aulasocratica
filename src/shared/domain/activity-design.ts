// Client-safe shapes, defaults and sanitizers for the teacher-editable rubric and
// reflection questions of an activity (stored as JSON on the activity row).

export interface RubricLevel {
  label: string;
  description: string;
}

export interface RubricCriterion {
  id: string;
  name: string;
  description: string;
  levels: RubricLevel[];
}

export interface ReflectionQuestion {
  key: string;
  question: string;
}

export const MAX_CRITERIA = 8;
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 5;
export const MAX_REFLECTION_QUESTIONS = 6;

export const DEFAULT_LEVEL_LABELS = ["En inicio", "En proceso", "Logrado", "Destacado"];

export const DEFAULT_REFLECTION_QUESTIONS: ReflectionQuestion[] = [
  { key: "discovered", question: "¿Qué descubriste durante la actividad?" },
  { key: "changed", question: "¿Qué cambiaste de tu respuesta y por qué?" },
];

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyCriterion(): RubricCriterion {
  return {
    id: newKey(),
    name: "",
    description: "",
    levels: DEFAULT_LEVEL_LABELS.map((label) => ({ label, description: "" })),
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Accepts any stored/AI value and returns a valid rubric (drops unnamed criteria). */
export function sanitizeRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RubricCriterion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = str(r["name"], 120);
    if (!name) continue;
    let id = str(r["id"], 40) || newKey();
    if (seen.has(id)) id = newKey();
    seen.add(id);
    const levels = (Array.isArray(r["levels"]) ? r["levels"] : [])
      .map((l) => {
        const lv = (l ?? {}) as Record<string, unknown>;
        return { label: str(lv["label"], 40), description: str(lv["description"], 500) };
      })
      .filter((l) => l.label)
      .slice(0, MAX_LEVELS);
    if (levels.length < MIN_LEVELS) continue;
    out.push({ id, name, description: str(r["description"], 500), levels });
    if (out.length >= MAX_CRITERIA) break;
  }
  return out;
}

/** Accepts any stored/AI value and returns valid reflection questions (0..6). */
export function sanitizeReflectionQuestions(value: unknown): ReflectionQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ReflectionQuestion[] = [];
  for (const raw of value) {
    const r = (typeof raw === "string" ? { question: raw } : raw ?? {}) as Record<string, unknown>;
    const question = str(r["question"], 300);
    if (!question) continue;
    let key = str(r["key"], 40).replace(/[^a-zA-Z0-9_-]/g, "") || newKey();
    if (seen.has(key)) key = newKey();
    seen.add(key);
    out.push({ key, question });
    if (out.length >= MAX_REFLECTION_QUESTIONS) break;
  }
  return out;
}

/** Stored reflection answers: new format is an array with the question text snapshot. */
export interface ReflectionAnswer {
  key: string;
  question: string;
  answer: string;
}

/** Reads both the legacy keyed object and the new array format. */
export function readReflection(value: unknown, legacyQuestions: readonly { key: string; question: string }[]): ReflectionAnswer[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (v ?? {}) as Record<string, unknown>)
      .map((v) => ({ key: str(v["key"], 40), question: str(v["question"], 300), answer: str(v["answer"], 2000) }))
      .filter((v) => v.answer);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return legacyQuestions
      .map((q) => ({ key: q.key, question: q.question, answer: str(obj[q.key], 2000) }))
      .filter((v) => v.answer);
  }
  return [];
}

/** Rubric upload: which files can be read into the editor. */
export type RubricUploadKind = "pdf" | "image" | "docx" | "text";
export const MAX_RUBRIC_UPLOAD_BYTES = 8 * 1024 * 1024;
export const RUBRIC_UPLOAD_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.docx,.txt,.csv,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv";

export function rubricUploadKind(name: string, mime: string): RubricUploadKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(ext) || ["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  if (ext === "docx") return "docx";
  if (ext === "txt" || ext === "csv" || mime === "text/plain" || mime === "text/csv") return "text";
  return null;
}

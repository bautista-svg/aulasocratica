// Request bodies (zod) and response types of the student API (/api/s/:token/...).
// Students have no account: identity is their name inside the classroom plus an httpOnly
// device cookie. The client never sends ids to pick a session.
import { z } from "zod";
import { STUDENT_INTENTS, type StudentIntent } from "../domain/pedagogy";
import type { LinkAvailability } from "../domain/access-rules";
import type { ReflectionAnswer, ReflectionQuestion } from "../domain/activity-design";
import type { VoiceLanguage } from "../domain/voice";
import type { FileKind } from "../domain/files";
import { AWAY_MIN_MS, PASTE_MIN_CHARS } from "../domain/alerts";

export const MAX_CHAT_CHARS = 3000;
export const MIN_ANSWER_CHARS = 3;
export const MAX_ANSWER_CHARS = 4000;
export const MAX_REFLECTION_ANSWER_CHARS = 2000;
export const RESUME_CODE_LENGTH = 6;

export const joinBody = z.object({
  name: z.string().max(200, "El nombre es demasiado largo."),
});

export const resumeBody = z.object({
  name: z.string().max(200, "El nombre es demasiado largo."),
  code: z.string().trim().min(1, "Escribí tu código.").max(20, "El código tiene 6 letras y números."),
});

export const initialAnswerBody = z.object({
  answer: z
    .string()
    .trim()
    .min(MIN_ANSWER_CHARS, "Escribí al menos unas palabras.")
    .max(MAX_ANSWER_CHARS, `Tu respuesta puede tener hasta ${MAX_ANSWER_CHARS} caracteres.`),
});

const intentKeys = Object.keys(STUDENT_INTENTS) as [StudentIntent, ...StudentIntent[]];

export const chatBody = z
  .object({
    text: z.string().trim().max(MAX_CHAT_CHARS, `Tu mensaje puede tener hasta ${MAX_CHAT_CHARS} caracteres.`).default(""),
    intent: z.enum(intentKeys).nullable().default(null),
    inputMode: z.enum(["text", "voice"]).default("text"),
    /** Ask the tutor again for the last student message (after a failed reply). */
    retry: z.boolean().default(false),
  })
  .refine((b) => b.retry || b.text.length > 0, { message: "Escribí un mensaje.", path: ["text"] });
export type ChatInput = z.input<typeof chatBody>;

export const finishBody = z.object({
  finalAnswer: z
    .string()
    .trim()
    .min(MIN_ANSWER_CHARS, "Escribí tu respuesta final.")
    .max(MAX_ANSWER_CHARS, `Tu respuesta puede tener hasta ${MAX_ANSWER_CHARS} caracteres.`),
  reflection: z
    .array(
      z.object({
        key: z.string().max(40),
        answer: z
          .string()
          .trim()
          .max(MAX_REFLECTION_ANSWER_CHARS, `Cada respuesta puede tener hasta ${MAX_REFLECTION_ANSWER_CHARS} caracteres.`),
      }),
    )
    .max(10)
    .default([]),
});
export type FinishInput = z.input<typeof finishBody>;

export const signalBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pasted_text"),
    chars: z.number().int().min(PASTE_MIN_CHARS).max(200_000),
    /** Part of the pasted text matches the activity's own material. */
    fromMaterial: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("left_app"),
    awayMs: z.number().int().min(AWAY_MIN_MS).max(86_400_000),
    /** Left right after opening one of the activity's files (not counted as leaving). */
    fromMaterial: z.boolean().default(false),
  }),
]);
export type SignalInput = z.input<typeof signalBody>;

// ── Responses ──

export interface StudentActivityPublic {
  title: string;
  subject: string;
  /** "5.º B · Escuela N.º 12" style label. */
  classroom: string;
  teacherName: string;
}

/** GET /api/s/:token — what the link page needs on load. */
export interface StudentLinkInfo {
  availability: LinkAvailability;
  /** Why it is closed (null when available). */
  message: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  /** Null for unpublished or archived activities. */
  activity: StudentActivityPublic | null;
  /** The work of the student signed in on this device (only while the link is available). */
  workspace: StudentWorkspace | null;
}

export interface StudentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  inputMode: "text" | "voice";
  createdAt: string;
}

export interface StudentFile {
  id: string;
  name: string;
  kind: FileKind;
  mimeType: string;
  sizeBytes: number;
  /** Same-origin URL; only works with this device's session cookie. */
  url: string;
}

export type StudentStage = "initial" | "tutor" | "completed" | "ended";

export interface StudentWorkspace {
  studentName: string;
  /** Code to continue on another device (also visible to the teacher). */
  resumeCode: string;
  stage: StudentStage;
  session: {
    status: "in_progress" | "completed";
    endedByTeacher: boolean;
    initialAnswer: string | null;
    finalAnswer: string | null;
    reflection: ReflectionAnswer[];
    hintCount: number;
    startedAt: string;
    completedAt: string | null;
  };
  activity: {
    title: string;
    subject: string;
    objectives: string;
    instructions: string;
    material: string;
    requireInitialAnswer: boolean;
    voiceLanguage: VoiceLanguage;
    reflectionQuestions: ReflectionQuestion[];
  };
  files: StudentFile[];
  messages: StudentMessage[];
  /** The tutor is still writing a reply on the server (e.g. after a reload mid-reply). */
  replyPending: boolean;
}

export interface WorkspaceResponse {
  workspace: StudentWorkspace;
}

/** Server-Sent Events of POST /api/s/:token/chat. */
export type ChatStreamEvent =
  | { event: "start"; data: { userMessageId: string | null } }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { messageId: string; text: string } }
  | { event: "error"; data: { message: string; code: string } };

/** Error codes of the student API the UI reacts to. */
export type StudentErrorCode =
  | "not_found"
  | "unavailable"
  | "no_session"
  | "resume_required"
  | "wrong_code"
  | "locked"
  | "read_only"
  | "initial_required"
  | "busy"
  | "nothing_to_retry"
  | "rate_limited"
  | "ai_quota";

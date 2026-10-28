// Request bodies (zod) and response types of the student API (/api/s/:token/...).
// Students have no account: identity is their name inside the classroom plus an httpOnly
// device cookie. The client never sends ids to pick a session.
import { z } from "zod";
import { STUDENT_INTENTS, type StudentIntent } from "../domain/pedagogy";
import type { LinkAvailability } from "../domain/access-rules";
import type { ReflectionAnswer, ReflectionQuestion } from "../domain/activity-design";
import type { VoiceLanguage } from "../domain/voice";
import type { FileKind } from "../domain/files";
import { DELIVERABLE_URL_MAX, type DeliverableKind, type DeliverableMode } from "../domain/deliverables";
import { MAX_CONSIGNAS } from "../domain/consignas";
import type { ActivityLanguage } from "../domain/language";
import type { SectionKey, SectionText } from "../domain/structure";
import { AWAY_MIN_MS, PASTE_MIN_CHARS } from "../domain/alerts";
import type { SummaryPoint } from "../domain/session-summary";
import { MAX_ANSWER_CHARS, MAX_CHAT_CHARS, MAX_REFLECTION_ANSWER_CHARS, MIN_ANSWER_CHARS } from "./student-limits";

export { MAX_ANSWER_CHARS, MAX_CHAT_CHARS, MAX_REFLECTION_ANSWER_CHARS, MIN_ANSWER_CHARS, RESUME_CODE_LENGTH, RESUME_CODE_ALPHABET, normalizeResumeCode, resumeCodeProblem, studentMetaLine } from "./student-limits";
import { normalizeResumeCode, resumeCodeProblem } from "./student-limits";

/** The division picked among the classroom's (checked on the server; ignored when it asks for none). */
const divisionField = z.string().max(200).optional();

export const joinBody = z.object({
  name: z.string().max(200, "El nombre es demasiado largo."),
  division: divisionField,
});

export const resumeBody = z.object({
  name: z.string().max(200, "El nombre es demasiado largo."),
  division: divisionField,
  code: z
    .string()
    .trim()
    .max(20, "El código tiene 6 letras y números.")
    .superRefine((code, ctx) => {
      const problem = resumeCodeProblem(code);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
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
    /** The consigna the student is on (index), so the tutor accompanies that one. */
    consigna: z.number().int().min(0).max(MAX_CONSIGNAS - 1).optional(),
  })
  .refine((b) => b.retry || b.text.length > 0, { message: "Escribí un mensaje.", path: ["text"] });
export type ChatInput = z.input<typeof chatBody>;

const answerText = z.string().trim().max(MAX_ANSWER_CHARS, `Tu respuesta puede tener hasta ${MAX_ANSWER_CHARS} caracteres.`);

/** One final answer, or one per consigna when the activity has several (checked against them on the server). */
/** One consigna's written answer, saved while the student types. */
export const consignaAnswerBody = z.object({
  consignaId: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  text: z.string().max(MAX_ANSWER_CHARS, `Tu respuesta puede tener hasta ${MAX_ANSWER_CHARS} caracteres.`),
});

export const finishBody = z.object({
  finalAnswer: answerText.default(""),
  /** Sent by older screens (one answer per consigna at the end). */
  finalAnswers: z.array(answerText).max(MAX_CONSIGNAS).optional(),
  /** The latest answers of the consignas (they are also saved while typing). */
  consignaAnswers: z.record(z.string().max(40), answerText).optional(),
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
  /** Language of the student's screens ("es" or "en"). */
  language: ActivityLanguage;
  subject: string;
  /** "5.º B · Escuela N.º 12" style label (show it with studentMetaLine([subject, classroom])). */
  classroom: string;
  teacherName: string;
  /** Divisions to pick one from when entering (empty: not asked). */
  divisions: string[];
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
  /**
   * The work of the student signed in on this device: while the link is available, and also
   * when it is closed (inactive, not started, expired) but this device's work is already
   * finished or was closed by the teacher — then read-only and without files.
   */
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
  /** Same-origin URL (only works with this device's session cookie); for a link, its address. */
  url: string;
}

export const deliverableLinkBody = z.object({ url: z.string().max(DELIVERABLE_URL_MAX + 100) });

/** The file the student handed in (or is about to) with the final answer. */
export interface StudentDeliverable {
  /** For a link: a label such as "Documento de Google". */
  name: string;
  kind: DeliverableKind;
  sizeBytes: number;
  uploadedAt: string;
  /** Same-origin URL; only works with this device's session cookie. */
  url: string;
}

export type StudentStage = "initial" | "tutor" | "completed" | "ended";

export interface StudentConsigna {
  id: string;
  title: string;
  text: string;
  /** The student writes an answer in this consigna. */
  answer: boolean;
}

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
    /** With several consignas: one answer per consigna. */
    finalAnswers: string[];
    /** The answer written in each consigna while working (by consigna id). */
    consignaAnswers: Record<string, string>;
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
    /** Every consigna in order, shown one at a time (title already defaulted). */
    consignas: StudentConsigna[];
    /** Shown before starting, with «Comenzar actividad» (null: no presentation). */
    presentation: string | null;
    /** Whether the closing asks for a final production. */
    askFinalAnswer: boolean;
    /** Titles and subtitles of the sections (the teacher's, else the defaults of the language). */
    sections: Record<SectionKey, SectionText>;
    /** The closing question, already defaulted (in the activity's language). */
    finalQuestion: string;
    /** Language of the student's screens and the tutor. */
    language: ActivityLanguage;
    /** The teacher's message for the end (nothing to answer), or null. */
    closingMessage: string | null;
    material: string;
    requireInitialAnswer: boolean;
    voiceLanguage: VoiceLanguage;
    reflectionQuestions: ReflectionQuestion[];
    /** Whether a file is asked for when finishing, and what it should be. */
    deliverableMode: DeliverableMode;
    deliverablePrompt: string;
  };
  files: StudentFile[];
  /** Files the teacher uploaded that are still being read (they show up when ready). */
  filesPending: number;
  deliverable: StudentDeliverable | null;
  messages: StudentMessage[];
  /** The tutor is still writing a reply on the server (e.g. after a reload mid-reply). */
  replyPending: boolean;
  /** The AI summary of their work, when the activity shares it (null: not shared, or none). */
  feedback: StudentFeedback | null;
}

/**
 * The AI summary of the student's own work, when the activity shares it (Configuración →
 * Devolución de la IA): "pending" while the AI is still writing it right after sending.
 */
export type StudentFeedback =
  | { status: "pending" }
  | { status: "ready"; overview: string; criteria: SummaryPoint[]; objectives: SummaryPoint[]; nextSteps: string[] };

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
  | "invalid"
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
  | "ai_quota"
  | "deliverable_required";

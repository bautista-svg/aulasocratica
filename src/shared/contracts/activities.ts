import {
  CONSIGNA_TITLE_MAX,
  PRESENTATION_MAX,
  SECTION_KEYS,
  SECTION_SUBTITLE_MAX,
  SECTION_TITLE_MAX,
  sanitizeSectionTitles,
  type Consigna,
  type SectionTitles,
} from "../domain/structure";
import { z } from "zod";
import {
  MAX_CRITERIA,
  MAX_LEVELS,
  MAX_REFLECTION_QUESTIONS,
  MIN_LEVELS,
  type RubricCriterion,
  type ReflectionQuestion,
} from "../domain/activity-design";
import type { VoiceLanguage } from "../domain/voice";
import { DELIVERABLE_PROMPT_MAX, type DeliverableMode } from "../domain/deliverables";
import type { FileKind, ProcessingStatus } from "../domain/files";
import { MAX_TUTOR_TYPES, TUTOR_TYPES } from "../domain/pedagogy";
import { CLOSING_MESSAGE_MAX, FINAL_QUESTION_MAX, MAX_CONSIGNAS } from "../domain/consignas";
import type { ActivityLanguage } from "../domain/language";
import { MAX_TUTOR_RULES, MAX_TUTOR_RULES_WORDS, countWords } from "../domain/tutors";

export type ActivityStatus = "draft" | "published" | "archived";
export type HelpLevel = "autonomous" | "moderate" | "intensive";

/** One activity in a classroom list. Participants are counted per activity (never per classroom). */
export interface ActivitySummary {
  id: string;
  classroomId: string;
  title: string;
  subject: string;
  status: ActivityStatus;
  linkActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: number;
  completed: number;
  activeNow: number;
  openAlerts: number;
  /** The classroom is archived: the activity does not accept students whatever its own state. */
  classroomArchived: boolean;
}

/** An activity in the classroom's "Papelera". */
export interface TrashedActivity {
  id: string;
  title: string;
  deletedAt: string;
  /** When it is removed for good. */
  purgeAt: string;
  participants: number;
}

/** Days a deleted activity stays in the "Papelera" before it is removed for good. */
export const TRASH_DAYS = 30;

/**
 * Client-generated id of one create request. Sending the same id again (a double click, a retry
 * after a lost response) returns the record created the first time instead of a duplicate.
 */
export const requestIdField = z.string().uuid().optional();

export const createActivityBody = z.object({
  classroomId: z.string().uuid(),
  title: z.string().trim().min(1, "Poné un título.").max(160, "Usá hasta 160 caracteres."),
  /** Optional saved tutor to start from. */
  tutorId: z.string().uuid().nullable().optional(),
  /** Language of the student's screens and the tutor. */
  language: z.enum(["es", "en"]).default("es"),
  requestId: requestIdField,
});

export interface ActivityDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  subject: string;
  objectives: string;
  instructions: string;
  /** Consignas after the first one. */
  moreInstructions: string[];
  /** The consignas with their title and written answer (the source the editor edits). */
  consignas: Consigna[];
  /** Shown before the activity starts (when on). */
  presentation: string;
  presentationOn: boolean;
  /** The objectives are shown to the students. */
  objectivesVisible: boolean;
  /** The teacher's titles and subtitles of the sections the students see. */
  sectionTitles: SectionTitles;
  material: string;
  tutorType: string;
  /** Other types combined with the main one (up to two). */
  extraTutorTypes: string[];
  helpLevel: HelpLevel;
  tutorRules: string;
  tutorId: string | null;
  tutorName: string | null;
  requireInitialAnswer: boolean;
  /** Ask for a final answer when closing (off: only reflection and delivery). */
  askFinalAnswer: boolean;
  /** The closing question ("" = «¿Qué pensás ahora?»). */
  finalQuestion: string;
  /** Language of the student's screens and the tutor. */
  language: ActivityLanguage;
  /** Ask the reflection questions when closing (off: they are kept, not asked). */
  askReflection: boolean;
  /** Show the closing message (something to read, nothing to answer). */
  closingMessageOn: boolean;
  closingMessage: string;
  voiceLanguage: VoiceLanguage;
  /** Whether students hand in a file when they finish. */
  deliverableMode: DeliverableMode;
  /** What the file should be, shown to the student. */
  deliverablePrompt: string;
  /** Each student sees the AI summary of their work (with next steps) after sending it. */
  shareSummary: boolean;
  rubric: RubricCriterion[];
  reflectionQuestions: ReflectionQuestion[];
  status: ActivityStatus;
  publishedAt: string | null;
  linkToken: string;
  linkActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the activity editor receives: the detail plus a few facts the screen needs. */
export interface ActivityEditorData extends ActivityDetail {
  classroomArchived: boolean;
  /** In the classroom's "Papelera" since then (it can be restored until it is removed). */
  deletedAt: string | null;
  /** Students who joined this activity (its learning sessions). */
  participants: number;
  completed: number;
}

/** A file attached to an activity. Its extracted text is what the tutor reads. */
export interface ActivityFile {
  id: string;
  activityId: string;
  fileName: string;
  mimeType: string;
  kind: FileKind;
  sizeBytes: number;
  pageCount: number | null;
  processingStatus: ProcessingStatus;
  /** When failed: why. When ready: an optional note (e.g. "PDF escaneado: el texto se transcribió con IA."). */
  processingError: string | null;
  /** Characters of extracted text available to the tutor. */
  textChars: number;
  teacherNote: string;
  /**
   * Only for failed files: false when reading it again cannot work (damaged or protected PDF,
   * unreadable Word, image too big, file gone). Then the way out is to remove it or upload another version.
   */
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityResponse {
  activity: ActivityEditorData;
}

export interface ActivityWithFilesResponse extends ActivityResponse {
  files: ActivityFile[];
}

// ── Limits (shared by the form and the API) ──

export const ACTIVITY_LIMITS = {
  title: 160,
  subject: 80,
  objectives: 4000,
  instructions: 6000,
  material: 20000,
  tutorRules: MAX_TUTOR_RULES,
  teacherNote: 20000,
  aiRequest: 600,
} as const;

const text = (max: number) => z.string().trim().max(max, `Usá hasta ${max.toLocaleString("es-AR")} caracteres.`);

const rubricLevelInput = z.object({
  label: z.string().trim().min(1, "Poné un nombre al nivel.").max(40, "Usá hasta 40 caracteres."),
  description: z.string().trim().max(500, "Usá hasta 500 caracteres.").default(""),
});

export const rubricCriterionInput = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1, "Poné un nombre al criterio.").max(120, "Usá hasta 120 caracteres."),
  description: z.string().trim().max(500, "Usá hasta 500 caracteres.").default(""),
  levels: z
    .array(rubricLevelInput)
    .min(MIN_LEVELS, `Cada criterio necesita al menos ${MIN_LEVELS} niveles.`)
    .max(MAX_LEVELS, `Cada criterio puede tener hasta ${MAX_LEVELS} niveles.`),
});

export const reflectionQuestionInput = z.object({
  key: z.string().max(40).optional(),
  question: z.string().trim().min(1, "Escribí la pregunta o borrala.").max(300, "Usá hasta 300 caracteres."),
});

const tutorTypeSchema = z.string().refine((v) => v in TUTOR_TYPES, "Elegí un tipo de tutor de la lista.");
const helpLevelSchema = z.enum(["autonomous", "moderate", "intensive"], { message: "Elegí un nivel de ayuda." });
const voiceSchema = z.enum(["off", "es", "en"], { message: "Elegí una opción de voz." });

/** Every editable field of an activity (all optional: send only what changed). */
export const activityPatch = z
  .object({
    title: z.string().trim().min(1, "Poné un título.").max(ACTIVITY_LIMITS.title, "Usá hasta 160 caracteres."),
    subject: text(ACTIVITY_LIMITS.subject),
    objectives: text(ACTIVITY_LIMITS.objectives),
    instructions: text(ACTIVITY_LIMITS.instructions),
    moreInstructions: z.array(text(ACTIVITY_LIMITS.instructions)).max(MAX_CONSIGNAS - 1, `Podés poner hasta ${MAX_CONSIGNAS} consignas.`),
    consignas: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]{1,40}$/i, "Consigna inválida."),
          title: text(CONSIGNA_TITLE_MAX),
          text: text(ACTIVITY_LIMITS.instructions),
          answer: z.boolean(),
        }),
      )
      .max(MAX_CONSIGNAS, `Podés poner hasta ${MAX_CONSIGNAS} consignas.`),
    presentation: text(PRESENTATION_MAX),
    presentationOn: z.boolean(),
    objectivesVisible: z.boolean(),
    sectionTitles: z
      .partialRecord(z.enum(SECTION_KEYS), z.object({ title: text(SECTION_TITLE_MAX), subtitle: text(SECTION_SUBTITLE_MAX) }))
      .transform((v) => sanitizeSectionTitles(v)),
    material: text(ACTIVITY_LIMITS.material),
    tutorType: tutorTypeSchema,
    extraTutorTypes: z.array(tutorTypeSchema).max(MAX_TUTOR_TYPES - 1, `Podés combinar hasta ${MAX_TUTOR_TYPES} tipos de tutor.`),
    helpLevel: helpLevelSchema,
    tutorRules: text(ACTIVITY_LIMITS.tutorRules).refine((v) => countWords(v) <= MAX_TUTOR_RULES_WORDS, `Usá hasta ${MAX_TUTOR_RULES_WORDS} palabras.`),
    /** Only `null` is accepted here (unlink the saved tutor); to apply one use POST /:id/tutor. */
    tutorId: z.null(),
    requireInitialAnswer: z.boolean(),
    askFinalAnswer: z.boolean(),
    language: z.enum(["es", "en"], { message: "Elegí el idioma de la actividad." }),
    askReflection: z.boolean(),
    closingMessageOn: z.boolean(),
    closingMessage: text(CLOSING_MESSAGE_MAX),
    finalQuestion: text(FINAL_QUESTION_MAX),
    voiceLanguage: voiceSchema,
    deliverableMode: z.enum(["off", "optional", "required"], { message: "Elegí si pedís un archivo en la entrega." }),
    deliverablePrompt: text(DELIVERABLE_PROMPT_MAX),
    shareSummary: z.boolean(),
    rubric: z.array(rubricCriterionInput).max(MAX_CRITERIA, `La rúbrica puede tener hasta ${MAX_CRITERIA} criterios.`),
    reflectionQuestions: z
      .array(reflectionQuestionInput)
      .max(MAX_REFLECTION_QUESTIONS, `Podés poner hasta ${MAX_REFLECTION_QUESTIONS} preguntas.`),
  })
  .partial();
export type ActivityPatch = z.input<typeof activityPatch>;

export const applyTutorBody = z.object({ tutorId: z.string().uuid("Elegí un tutor de la lista.") });

const isoOrNull = z
  .string()
  .datetime({ offset: true, message: "Fecha inválida." })
  .nullable();

export const linkPatch = z
  .object({
    linkActive: z.boolean().optional(),
    startsAt: isoOrNull.optional(),
    expiresAt: isoOrNull.optional(),
  })
  .refine((v) => !(v.startsAt && v.expiresAt) || new Date(v.expiresAt).getTime() > new Date(v.startsAt).getTime(), {
    message: "El cierre tiene que ser después de la apertura.",
    path: ["expiresAt"],
  });
export type LinkPatch = z.input<typeof linkPatch>;

export const duplicateBody = z.object({
  /** Another classroom of the same workspace (defaults to the activity's classroom). */
  classroomId: z.string().uuid().optional(),
  requestId: requestIdField,
});

export const resetBody = z.object({
  confirm: z.literal("REINICIAR", { message: "Escribí REINICIAR para confirmar." }),
  regenerateLink: z.boolean().optional(),
});

export const deleteActivityBody = z.object({
  confirm: z.literal("BORRAR", { message: "Escribí BORRAR para confirmar." }),
});

export const fileNoteBody = z.object({ teacherNote: text(ACTIVITY_LIMITS.teacherNote) });

/** Unsaved values of the editor, so the AI sees what the teacher is writing right now. */
const draftContext = z
  .object({
    title: text(ACTIVITY_LIMITS.title),
    subject: text(ACTIVITY_LIMITS.subject),
    objectives: text(ACTIVITY_LIMITS.objectives),
    instructions: text(ACTIVITY_LIMITS.instructions),
    material: text(ACTIVITY_LIMITS.material),
  })
  .partial();

export const aiRubricBody = z.object({
  request: text(ACTIVITY_LIMITS.aiRequest).optional(),
  count: z.number().int().min(1).max(MAX_CRITERIA).default(3),
  /** Names of criteria already in the editor (the AI should not repeat them). */
  existing: z.array(z.string().max(120)).max(MAX_CRITERIA).default([]),
  context: draftContext.optional(),
});
export type AiRubricInput = z.input<typeof aiRubricBody>;

export const aiReflectionBody = z.object({
  request: text(ACTIVITY_LIMITS.aiRequest).optional(),
  count: z.number().int().min(1).max(MAX_REFLECTION_QUESTIONS).default(2),
  existing: z.array(z.string().max(300)).max(MAX_REFLECTION_QUESTIONS).default([]),
  context: draftContext.optional(),
});
export type AiReflectionInput = z.input<typeof aiReflectionBody>;

export interface RubricProposalResponse {
  criteria: RubricCriterion[];
}
export interface ReflectionProposalResponse {
  questions: ReflectionQuestion[];
}
export interface RubricImportResponse {
  criteria: RubricCriterion[];
  /** The file had more criteria than the editor allows; only the first ones were kept. */
  truncated: boolean;
}

export interface UploadFilesResponse {
  files: ActivityFile[];
  rejected: { fileName: string; error: string }[];
}

export interface FileTextResponse {
  text: string;
  offset: number;
  limit: number;
  total: number;
  nextOffset: number | null;
}

export interface ResetResponse {
  ok: true;
  deleted: { sessions: number; messages: number; students: number };
  linkRegenerated: boolean;
  activity: ActivityEditorData;
}

export interface DuplicateResponse {
  activity: ActivityEditorData;
  copiedFiles: number;
  skippedFiles: number;
}

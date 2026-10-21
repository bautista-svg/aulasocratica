// One student's work in one activity (a learning session), seen by the teacher.
import { z } from "zod";
import type { RubricCriterion, ReflectionAnswer, ReflectionQuestion } from "../domain/activity-design";
import type { LiveStatus, Stage } from "../domain/live-monitor";
import type { SessionSummaryContent, SummaryBasis } from "../domain/session-summary";
import type { XrayItem } from "../domain/thinking-xray";
import type { AlertStatus } from "./live";

export { confirmBody } from "./live";

export const rubricSaveBody = z.object({
  /** criterionId → chosen level index. Criteria left out stay without a level. */
  levels: z.record(z.string().max(40), z.number().int().min(0, "Nivel inválido.").max(9, "Nivel inválido.")),
  comment: z.string().trim().max(2000, "Usá hasta 2000 caracteres.").default(""),
  confirm: z.boolean(),
});
export type RubricSaveInput = z.input<typeof rubricSaveBody>;

export const summaryBody = z.object({
  basis: z
    .array(z.enum(["rubric", "objectives"]))
    .min(1, "Elegí en qué basar el resumen.")
    .max(2),
});

export const xrayItemPatch = z
  .object({
    status: z.enum(["suggested", "validated", "discarded"]).optional(),
    interpretation: z.string().trim().min(1, "Escribí la interpretación.").max(600, "Usá hasta 600 caracteres.").optional(),
  })
  .refine((v) => v.status !== undefined || v.interpretation !== undefined, { message: "No hay cambios para guardar." });

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  inputMode: "text" | "voice";
  /** The tutor reply that is still being written (streaming). */
  isPartial: boolean;
  createdAt: string;
}

export interface SessionEvent {
  id: string;
  eventType: string;
  source: "observed" | "inferred";
  createdAt: string;
  /** Only numeric/boolean details (counts, durations); never student content. */
  details: Record<string, number | boolean>;
}

export interface SessionAlert {
  id: string;
  alertKey: string;
  name: string;
  category: string;
  severity: "review" | "immediate";
  source: string;
  origin: "ai" | "observed";
  evidence: string;
  reason: string;
  status: AlertStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RubricSuggestionItem {
  criterionId: string;
  /** null when the AI found no sufficient evidence for this criterion. */
  levelIndex: number | null;
  /** Verbatim quote of the student; empty when there was none or it could not be verified. */
  evidence: string;
  rationale: string;
  /** The AI quoted something the student did not write: the quote was removed. */
  evidenceDropped: boolean;
}

export interface RubricAssessmentView {
  /** Rubric the levels refer to (snapshot of the assessment, or the activity's current rubric). */
  rubric: RubricCriterion[];
  /** The activity rubric changed after this assessment was started. */
  rubricChanged: boolean;
  suggestion: RubricSuggestionItem[] | null;
  aiGeneratedAt: string | null;
  teacherLevels: Record<string, number>;
  comment: string;
  status: "none" | "draft" | "confirmed";
  confirmedAt: string | null;
}

export interface SummaryView {
  basis: SummaryBasis[];
  content: SessionSummaryContent;
  generatedAt: string;
  /** Quotes the AI proposed that do not appear in what the student wrote (removed). */
  droppedQuotes: number;
  /** Messages left out of a very long conversation (0 = the AI read all of it). */
  omittedMessages: number;
}

export interface XrayView {
  /** Interpretations the teacher has not discarded. */
  items: XrayItem[];
  discardedCount: number;
  aiGeneratedAt: string | null;
}

export interface ObservedSignals {
  pasted: { count: number; chars: number; fromMaterial: boolean };
  leftApp: { count: number; totalMs: number; longestMs: number };
  /** Teacher-facing sentences (empty when nothing was recorded). */
  summary: string[];
}

export interface SessionDetail {
  session: {
    id: string;
    status: "in_progress" | "completed";
    initialAnswer: string | null;
    finalAnswer: string | null;
    reflection: ReflectionAnswer[];
    hintCount: number;
    resumeCode: string;
    endedByTeacher: boolean;
    startedAt: string;
    lastActivityAt: string;
    completedAt: string | null;
    liveStatus: LiveStatus;
    lastSignalAt: string;
    currentStage: Stage | "done";
    /** Stage the student got to (for a work the teacher ended: where it was ended). */
    reachedStage: Stage;
    progressSteps: number;
    stepsTotal: 2 | 3;
  };
  student: { id: string; fullName: string };
  classroom: { id: string; name: string; label: string };
  activity: {
    id: string;
    title: string;
    instructions: string;
    objectives: string;
    requireInitialAnswer: boolean;
    status: string;
    rubric: RubricCriterion[];
    reflectionQuestions: ReflectionQuestion[];
  };
  messages: SessionMessage[];
  events: SessionEvent[];
  alerts: SessionAlert[];
  rubric: RubricAssessmentView;
  summary: SummaryView | null;
  summaryAvailable: { rubric: boolean; objectives: boolean };
  xray: XrayView;
  flow: { tutorQuestions: string[]; reformulations: { text: string; at: string; intent: string }[]; hints: number };
  signals: ObservedSignals;
}

export interface RubricSuggestResult {
  rubric: RubricAssessmentView;
  droppedQuotes: number;
}

export interface XrayAnalyzeResult {
  xray: XrayView;
  added: number;
  /** Interpretations removed because their quote does not appear in what the student wrote. */
  droppedQuotes: number;
  /** Interpretations not added because they repeat one you already kept or discarded. */
  duplicates: number;
  omittedMessages: number;
}

// ── Radiografía list ──

export interface XrayListItem {
  sessionId: string;
  studentId: string;
  studentName: string;
  activityId: string;
  activityTitle: string;
  classroomId: string;
  classroomName: string;
  status: "in_progress" | "completed";
  endedByTeacher: boolean;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  xray: { analyzed: boolean; validated: number; suggested: number; discarded: number };
}

export interface XrayListResponse {
  items: XrayListItem[];
  nextCursor: string | null;
}

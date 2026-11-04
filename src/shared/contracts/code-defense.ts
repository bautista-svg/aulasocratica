// «Defensa de código», the teacher's side: each student's code and how the defense went.
import { z } from "zod";
import { CODE_LIMITS, type DefenseBand, type DefenseVerdict, type QuestionKind } from "../domain/code-defense";

export interface DefenseCheckView {
  id: string;
  file: string;
  fromLine: number;
  code: string;
  kind: QuestionKind;
  change: { before: string; after: string } | null;
  question: string;
  attempts: number;
  answer: string;
  verdict: DefenseVerdict | null;
  reason: string;
  quote: string;
}

export interface DefenseStudentRow {
  studentId: string;
  name: string;
  division: string;
  sessionId: string | null;
  status: "waiting" | "working" | "done";
  /** The files of this student (empty when they use the activity's material or have none yet). */
  code: { name: string; lines: number; uploadedBy: "student" | "teacher" }[];
  checks: DefenseCheckView[];
  explained: number;
  partial: number;
  notExplained: number;
  answered: number;
  band: DefenseBand;
  /** Times they pasted text from outside the activity or left the page while working. */
  pastes: number;
  leftApp: number;
}

export interface DefenseResponse {
  /** The activity's material has text the tutor can ask about when a student has no code of their own. */
  sharedCode: boolean;
  students: DefenseStudentRow[];
}

export const teacherCodeBody = z.object({
  studentName: z.string().trim().min(2, "Escribí el nombre del alumno.").max(200),
  files: z.array(z.object({ name: z.string().max(300), text: z.string().max(CODE_LIMITS.fileChars + 1000) })).min(1).max(CODE_LIMITS.files + 20),
});
export type TeacherCodeBody = z.infer<typeof teacherCodeBody>;

export interface StudentCodeResponse {
  files: { name: string; text: string }[];
}

// Google Classroom: connect the teacher's Google account, publish an activity as an assignment in a
// course, bring a course's students into a classroom and send grades back.
import { z } from "zod";
import { MAX_POINTS_RANGE } from "../domain/classroom";

export interface ClassroomStatus {
  /** The server has a Google client configured (otherwise nothing of this shows). */
  available: boolean;
  connected: boolean;
  email: string | null;
  /** Connected, but some permission was left unticked on Google's screen. */
  missingScopes: boolean;
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section: string;
  url: string;
}

export interface ClassroomRosterStudent {
  userId: string;
  name: string;
}

export interface ClassroomLink {
  courseId: string;
  courseName: string;
  courseworkId: string;
  url: string;
  maxPoints: number;
  createdAt: string;
}

export const classroomPublishBody = z.object({
  courseId: z.string().trim().min(1, "Elegí un curso de Classroom.").max(80),
  maxPoints: z
    .number()
    .int("Usá un número entero.")
    .min(MAX_POINTS_RANGE.min, `Poné al menos ${MAX_POINTS_RANGE.min} punto.`)
    .max(MAX_POINTS_RANGE.max, `Poné hasta ${MAX_POINTS_RANGE.max} puntos.`),
  /** "YYYY-MM-DD", or null for no due date. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha válida.")
    .nullable()
    .default(null),
});
export type ClassroomPublishBody = z.input<typeof classroomPublishBody>;

export interface ClassroomGradeRow {
  sessionId: string;
  studentId: string;
  studentName: string;
  /** Grade out of the assignment's points, from the rubric (null when there is none yet). */
  suggestedGrade: number | null;
  /** Where the suggestion comes from. */
  source: "confirmed" | "suggested" | null;
  /** The Classroom student this one is (remembered or matched by name); null to pick by hand. */
  userId: string | null;
  /** The last grade sent to Classroom from here. */
  sent: { grade: number; returned: boolean; at: string } | null;
}

export interface ClassroomGradesResponse {
  link: ClassroomLink;
  rows: ClassroomGradeRow[];
  roster: ClassroomRosterStudent[];
}

export const classroomGradesBody = z.object({
  items: z
    .array(
      z.object({
        sessionId: z.string().uuid(),
        userId: z.string().trim().min(1).max(80),
        grade: z.number().min(0, "La nota no puede ser negativa.").max(MAX_POINTS_RANGE.max),
      }),
    )
    .min(1, "Elegí al menos un alumno.")
    .max(500),
  /** Also "Devolver" the work, so the student sees the grade in Classroom. */
  returnToStudents: z.boolean().default(false),
});
export type ClassroomGradesBody = z.input<typeof classroomGradesBody>;

export interface ClassroomGradesResult {
  sent: number;
  failed: { sessionId: string; message: string }[];
}

export const classroomImportBody = z.object({
  courseId: z.string().trim().min(1, "Elegí un curso de Classroom.").max(80),
});

export interface ClassroomImportResult {
  added: number;
  skipped: number;
}

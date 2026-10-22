import { z } from "zod";

const short = (max: number) => z.string().trim().max(max, `Usá hasta ${max} caracteres.`);

export const classroomBody = z.object({
  name: z.string().trim().min(1, "Poné un nombre para el aula.").max(120, "Usá hasta 120 caracteres."),
  school: short(160).default(""),
  /** The course's teacher ("Docente"). */
  teacherName: short(80).default(""),
  subject: short(80).default(""),
  grade: short(40).default(""),
  division: short(40).default(""),
  description: short(2000).default(""),
});
export type ClassroomInput = z.input<typeof classroomBody>;

/** POST: the same fields plus an optional request id (a repeated id returns the classroom created the first time). */
export const classroomCreateBody = classroomBody.extend({ requestId: z.string().uuid().optional() });

export const classroomPatch = classroomBody.partial().extend({ isArchived: z.boolean().optional() });

export interface ClassroomSummary {
  id: string;
  name: string;
  school: string;
  teacherName: string;
  subject: string;
  grade: string;
  division: string;
  description: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  activityCount: number;
  publishedCount: number;
  studentCount: number;
  /** Students working right now (signal in the last 2 minutes) across its activities. */
  activeNow: number;
}

export interface ClassroomDetail extends ClassroomSummary {}

export interface ClassroomStudent {
  id: string;
  fullName: string;
  selfRegistered: boolean;
  createdAt: string;
  /** Activities of this classroom the student worked on. */
  sessions: { sessionId: string; activityId: string; activityTitle: string; status: string; lastActivityAt: string }[];
}

export const addStudentsBody = z.object({
  names: z
    .array(z.string().trim().min(2, "Cada nombre debe tener al menos 2 letras.").max(120))
    .min(1, "Escribí al menos un nombre.")
    .max(200, "Podés agregar hasta 200 alumnos por vez."),
});

export const renameStudentBody = z.object({ fullName: z.string().trim().min(2).max(120) });

export function classroomLabel(c: { name: string; grade?: string; division?: string }): string {
  const gd = [c.grade, c.division].filter(Boolean).join(" ");
  return gd && !c.name.includes(gd) ? `${c.name} · ${gd}` : c.name;
}

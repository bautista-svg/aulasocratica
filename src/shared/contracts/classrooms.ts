import { z } from "zod";
import type { ClassroomRole } from "../domain/sharing";
import { divisionOptionsProblem, sanitizeDivisionOptions } from "../domain/divisions";

const short = (max: number) => z.string().trim().max(max, `Usá hasta ${max} caracteres.`);

const divisionOptions = z
  .array(z.string().max(200))
  .max(50, "Podés cargar hasta 12 divisiones.")
  .superRefine((list, ctx) => {
    const problem = divisionOptionsProblem(list);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  })
  .transform(sanitizeDivisionOptions);

const classroomFields = {
  name: z.string().trim().min(1, "Poné un nombre para el aula.").max(120, "Usá hasta 120 caracteres."),
  school: short(160),
  /** The course's teacher ("Docente"). */
  teacherName: short(80),
  subject: short(80),
  grade: short(40),
  division: short(40),
  description: short(2000),
  /** Divisions the students pick when entering (e.g. N, F, S); empty: they are not asked. */
  divisionOptions,
};

export const classroomBody = z.object({
  ...classroomFields,
  school: classroomFields.school.default(""),
  teacherName: classroomFields.teacherName.default(""),
  subject: classroomFields.subject.default(""),
  grade: classroomFields.grade.default(""),
  division: classroomFields.division.default(""),
  description: classroomFields.description.default(""),
  divisionOptions: divisionOptions.default([]),
});
export type ClassroomInput = z.input<typeof classroomBody>;

/** POST: the same fields plus an optional request id (a repeated id returns the classroom created the first time). */
export const classroomCreateBody = classroomBody.extend({ requestId: z.string().uuid().optional() });

// Built from the fields without defaults: zod 4 fills defaults in inside .partial(), so a PATCH
// with some fields (e.g. archiving) would blank the rest.
export const classroomPatch = z.object(classroomFields).partial().extend({ isArchived: z.boolean().optional() });

export interface ClassroomSummary {
  id: string;
  name: string;
  school: string;
  teacherName: string;
  subject: string;
  grade: string;
  division: string;
  description: string;
  divisionOptions: string[];
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  activityCount: number;
  publishedCount: number;
  studentCount: number;
  /** Students working right now (signal in the last 2 minutes) across its activities. */
  activeNow: number;
  /** The teacher's role here: "owner" for their own classrooms, else the role it was shared with. */
  role: ClassroomRole;
  /** Who created a classroom shared with this teacher ("" for their own). */
  ownerName: string;
  /** Other teachers it is shared with. */
  memberCount: number;
}

export interface ClassroomDetail extends ClassroomSummary {}

export interface ClassroomStudent {
  id: string;
  fullName: string;
  selfRegistered: boolean;
  /** The division they picked when entering ("" = none). */
  division: string;
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

/** Edits a student of the roster: their name and/or division ("" = without division). */
export const renameStudentBody = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    division: z.string().max(200).optional(),
  })
  .refine((b) => b.fullName !== undefined || b.division !== undefined, { message: "No hay cambios para guardar." });

export function classroomLabel(c: { name: string; grade?: string; division?: string }): string {
  const gd = [c.grade, c.division].filter(Boolean).join(" ");
  return gd && !c.name.includes(gd) ? `${c.name} · ${gd}` : c.name;
}

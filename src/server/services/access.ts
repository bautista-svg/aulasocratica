// Authorization helpers. Every teacher endpoint resolves the resource through one of these:
// a resource that exists but belongs to another workspace is reported as "not found", so
// ids from other workspaces cannot even be probed.
// They run on almost every request, so they are prepared statements: Drizzle builds the SQL once
// and Postgres reuses the parsed statement on each connection.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { notFound } from "../lib/errors";

const pId = sql.placeholder("id");
const pTeacher = sql.placeholder("teacherId");

const classroomQuery = db
  .select()
  .from(schema.classrooms)
  .where(and(eq(schema.classrooms.id, pId), eq(schema.classrooms.teacherId, pTeacher)))
  .limit(1)
  .prepare("owned_classroom");

const activityQuery = db
  .select()
  .from(schema.activities)
  .where(and(eq(schema.activities.id, pId), eq(schema.activities.teacherId, pTeacher)))
  .limit(1)
  .prepare("owned_activity");

const sessionQuery = db
  .select({ session: schema.learningSessions, activity: schema.activities, student: schema.students })
  .from(schema.learningSessions)
  .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
  .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
  .where(and(eq(schema.learningSessions.id, pId), eq(schema.activities.teacherId, pTeacher)))
  .limit(1)
  .prepare("owned_session");

export async function ownedClassroom(teacherId: string, classroomId: string) {
  if (!isUuid(classroomId)) throw notFound("El aula");
  const [row] = await classroomQuery.execute({ id: classroomId, teacherId });
  if (!row) throw notFound("El aula");
  return row;
}

export async function ownedActivity(teacherId: string, activityId: string) {
  if (!isUuid(activityId)) throw notFound("La actividad");
  const [row] = await activityQuery.execute({ id: activityId, teacherId });
  if (!row) throw notFound("La actividad");
  return row;
}

/** A student's session in one of the teacher's activities, with its activity and student. */
export async function ownedSession(teacherId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw notFound("El trabajo del alumno");
  const [row] = await sessionQuery.execute({ id: sessionId, teacherId });
  if (!row) throw notFound("El trabajo del alumno");
  return row;
}

export async function ownedStudent(teacherId: string, studentId: string) {
  if (!isUuid(studentId)) throw notFound("El alumno");
  const [row] = await db
    .select({ student: schema.students, classroom: schema.classrooms })
    .from(schema.students)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.students.classroomId))
    .where(and(eq(schema.students.id, studentId), eq(schema.classrooms.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("El alumno");
  return row;
}

export async function ownedTutor(teacherId: string, tutorId: string) {
  if (!isUuid(tutorId)) throw notFound("El tutor");
  const [row] = await db
    .select()
    .from(schema.tutors)
    .where(and(eq(schema.tutors.id, tutorId), eq(schema.tutors.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("El tutor");
  return row;
}

export async function ownedMaterial(teacherId: string, materialId: string) {
  if (!isUuid(materialId)) throw notFound("El material");
  const [row] = await db
    .select()
    .from(schema.materials)
    .where(and(eq(schema.materials.id, materialId), eq(schema.materials.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("El material");
  return row;
}

export async function ownedReport(teacherId: string, reportId: string) {
  if (!isUuid(reportId)) throw notFound("El informe");
  const [row] = await db
    .select()
    .from(schema.reports)
    .where(and(eq(schema.reports.id, reportId), eq(schema.reports.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("El informe");
  return row;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

// Authorization helpers. Every teacher endpoint resolves the resource through one of these.
// A classroom is reachable by its owner and by the teachers it is shared with (classroom_members);
// each helper returns the row with the teacher's effective `role` there, and routes that change
// something call `requireRole(row, action)` (403 with a clear message). A resource the teacher has no
// relation with is reported as "not found", so ids from other workspaces cannot even be probed.
// Activities always belong to the classroom owner's workspace (`activities.teacher_id`), also when a
// member creates them: tutors, library, skills and the AI budget are the owner's.
// They run on almost every request, so they are prepared statements: Drizzle builds the SQL once
// and Postgres reuses the parsed statement on each connection.
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { forbidden, notFound } from "../lib/errors";
import { can, deniedMessage, type ClassroomAction, type ClassroomRole, type MemberRole } from "@shared/domain/sharing";

const pId = sql.placeholder("id");
const pTeacher = sql.placeholder("teacherId");
const m = schema.classroomMembers;

/** The teacher's membership row in the classroom of the main table (left join: null when not a member). */
const memberOn = (classroomId: typeof schema.classrooms.id | typeof schema.activities.classroomId) =>
  and(eq(m.classroomId, classroomId), eq(m.teacherId, pTeacher));

const roleOf = (ownerId: string, teacherId: string, memberRole: string | null): ClassroomRole =>
  ownerId === teacherId ? "owner" : ((memberRole ?? "reader") as MemberRole);

const classroomQuery = db
  .select({ c: schema.classrooms, memberRole: m.role })
  .from(schema.classrooms)
  .leftJoin(m, memberOn(schema.classrooms.id))
  .where(and(eq(schema.classrooms.id, pId), or(eq(schema.classrooms.teacherId, pTeacher), isNotNull(m.teacherId))))
  .limit(1)
  .prepare("owned_classroom");

const activityQuery = db
  .select({ a: schema.activities, memberRole: m.role })
  .from(schema.activities)
  .leftJoin(m, memberOn(schema.activities.classroomId))
  .where(and(eq(schema.activities.id, pId), or(eq(schema.activities.teacherId, pTeacher), isNotNull(m.teacherId))))
  .limit(1)
  .prepare("owned_activity");

const sessionQuery = db
  .select({ session: schema.learningSessions, activity: schema.activities, student: schema.students, memberRole: m.role })
  .from(schema.learningSessions)
  .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
  .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
  .leftJoin(m, memberOn(schema.activities.classroomId))
  .where(and(eq(schema.learningSessions.id, pId), or(eq(schema.activities.teacherId, pTeacher), isNotNull(m.teacherId))))
  .limit(1)
  .prepare("owned_session");

/** 403 when the teacher's role in the classroom does not allow the action. */
export function requireRole(row: { role: ClassroomRole }, action: ClassroomAction): void {
  if (!can(row.role, action)) throw forbidden(deniedMessage(row.role, action));
}

export async function ownedClassroom(teacherId: string, classroomId: string) {
  if (!isUuid(classroomId)) throw notFound("El aula");
  const [row] = await classroomQuery.execute({ id: classroomId, teacherId });
  if (!row) throw notFound("El aula");
  return { ...row.c, role: roleOf(row.c.teacherId, teacherId, row.memberRole) };
}

export async function ownedActivity(teacherId: string, activityId: string) {
  if (!isUuid(activityId)) throw notFound("La actividad");
  const [row] = await activityQuery.execute({ id: activityId, teacherId });
  if (!row) throw notFound("La actividad");
  return { ...row.a, role: roleOf(row.a.teacherId, teacherId, row.memberRole) };
}

/** A student's session in one of the teacher's (own or shared) activities, with its activity and student. */
export async function ownedSession(teacherId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw notFound("El trabajo del alumno");
  const [row] = await sessionQuery.execute({ id: sessionId, teacherId });
  if (!row) throw notFound("El trabajo del alumno");
  const { memberRole, ...rest } = row;
  return { ...rest, role: roleOf(row.activity.teacherId, teacherId, memberRole) };
}

export async function ownedStudent(teacherId: string, studentId: string) {
  if (!isUuid(studentId)) throw notFound("El alumno");
  const [row] = await db
    .select({ student: schema.students, classroom: schema.classrooms, memberRole: m.role })
    .from(schema.students)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.students.classroomId))
    .leftJoin(m, and(eq(m.classroomId, schema.classrooms.id), eq(m.teacherId, teacherId)))
    .where(and(eq(schema.students.id, studentId), or(eq(schema.classrooms.teacherId, teacherId), isNotNull(m.teacherId))))
    .limit(1);
  if (!row) throw notFound("El alumno");
  return { student: row.student, classroom: row.classroom, role: roleOf(row.classroom.teacherId, teacherId, row.memberRole) };
}

/**
 * Ids of the classrooms the teacher can open (own + shared), for lists across classrooms
 * (Inicio, Alertas, Radiografía). Aliased tables, so it is safe inside any outer query.
 */
export function visibleClassroomIds(teacherId: string) {
  return sql`(select vc.id from classrooms vc where vc.teacher_id = ${teacherId}
    union all select vm.classroom_id from classroom_members vm where vm.teacher_id = ${teacherId})`;
}

/** Same, only where the teacher can change things (owner, admin or editor). */
export function editableClassroomIds(teacherId: string) {
  return sql`(select vc.id from classrooms vc where vc.teacher_id = ${teacherId}
    union all select vm.classroom_id from classroom_members vm where vm.teacher_id = ${teacherId} and vm.role <> 'reader')`;
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

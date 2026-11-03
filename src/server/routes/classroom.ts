// /api/classroom — Google Classroom. Connecting goes through Google's consent screen (a redirect,
// like "Continuar con Google"); the rest are JSON calls made with the teacher's own Google account.
import { Hono } from "hono";
import { asc, eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { env } from "../env";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { googleEnabled, startFlow } from "../auth/google";
import { HttpError, notFound, readJson } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { audit } from "../services/audit";
import { ownedActivity, ownedClassroom, requireRole } from "../services/access";
import {
  classroomStatus,
  courseworkOf,
  disconnect,
  gradeSubmission,
  listCourses,
  publishCoursework,
  rememberMatches,
  rememberedMatches,
  roster,
  submissions,
} from "../services/classroom";
import { gradeFromRubric, matchStudent } from "@shared/domain/classroom";
import { nameKey, tidyName } from "@shared/domain/names";
import { sanitizeRubric } from "@shared/domain/activity-design";
import {
  classroomGradesBody,
  classroomImportBody,
  classroomPublishBody,
  type ClassroomGradeRow,
  type ClassroomGradesResponse,
  type ClassroomGradesResult,
  type ClassroomImportResult,
} from "@shared/contracts/classroom";

const byTeacher = (c: Parameters<typeof teacherOf>[0]) => c.get("teacher")?.id ?? "anon";
const unavailable = () => new HttpError(503, "La conexión con Google no está configurada en este servidor.", "classroom_unavailable");

/** The assignment to grade: a «Consigna» (material) has no grades in Classroom. */
async function gradedLink(activityId: string) {
  const link = await courseworkOf(activityId);
  if (!link) throw notFound("La tarea de Classroom");
  if (link.kind !== "assignment" || link.maxPoints === null) {
    throw new HttpError(409, "Está en Classroom como consigna, sin nota. Para pasar notas, subila como tarea.", "classroom_not_graded");
  }
  return { ...link, maxPoints: link.maxPoints };
}

export const googleClassroomRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/status", async (c) => c.json(await classroomStatus(teacherOf(c).id, googleEnabled())))

  // A link the browser follows: off to Google's consent screen, back to `next` (see /auth/google/callback).
  .get("/connect", rateLimit("classroom-connect", 20, 15 * 60_000, byTeacher), (c) => {
    if (!googleEnabled()) return c.redirect("/app?classroom=no-disponible", 302);
    return c.redirect(startFlow(c, c.req.query("next") ?? "/app/cuenta", { teacherId: teacherOf(c).id }), 302);
  })

  .post("/disconnect", async (c) => {
    const t = teacherOf(c);
    await disconnect(t.id);
    await audit(c, t.id, "classroom_disconnected", "teacher", t.id);
    return c.json({ ok: true });
  })

  .get("/courses", rateLimit("classroom-read", 120, 15 * 60_000, byTeacher), async (c) => {
    if (!googleEnabled()) throw unavailable();
    return c.json({ courses: await listCourses(teacherOf(c).id) });
  })

  .get("/courses/:courseId/students", rateLimit("classroom-read", 120, 15 * 60_000, byTeacher), async (c) => {
    if (!googleEnabled()) throw unavailable();
    return c.json({ students: await roster(teacherOf(c).id, c.req.param("courseId")) });
  })

  // The students of a Classroom course come into a classroom of the app (by name; repeated ones are skipped).
  .post("/classrooms/:classroomId/import", rateLimit("classroom-write", 60, 15 * 60_000, byTeacher), async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("classroomId"));
    requireRole(room, "manage");
    const { courseId } = await readJson(c, classroomImportBody);
    const list = await roster(t.id, courseId);
    const values = list
      .map((s) => ({ fullName: tidyName(s.name), nameKey: nameKey(s.name), userId: s.userId }))
      .filter((v) => v.nameKey.length >= 2);
    const inserted = values.length
      ? await db
          .insert(schema.students)
          .values(values.map((v) => ({ fullName: v.fullName, nameKey: v.nameKey, classroomId: room.id, selfRegistered: false })))
          .onConflictDoNothing()
          .returning({ id: schema.students.id, nameKey: schema.students.nameKey })
      : [];
    // Each student is linked to its Classroom account right away (grades then need no matching).
    const all = await db
      .select({ id: schema.students.id, nameKey: schema.students.nameKey })
      .from(schema.students)
      .where(eq(schema.students.classroomId, room.id));
    const byKey = new Map(all.map((s) => [s.nameKey, s.id]));
    await rememberMatches(
      courseId,
      values.flatMap((v) => (byKey.has(v.nameKey) ? [{ studentId: byKey.get(v.nameKey)!, userId: v.userId }] : [])),
    );
    await audit(c, t.id, "classroom_roster_imported", "classroom", room.id, { added: inserted.length });
    const body: ClassroomImportResult = { added: inserted.length, skipped: values.length - inserted.length };
    return c.json(body);
  })

  .get("/activities/:activityId", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    return c.json({ link: await courseworkOf(activity.id) });
  })

  // Publishes the activity as an assignment or a material: its title, its consigna and the students' link.
  .post("/activities/:activityId/publish", rateLimit("classroom-write", 60, 15 * 60_000, byTeacher), async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    requireRole(activity, "edit");
    if (!googleEnabled()) throw unavailable();
    if (activity.status !== "published") throw new HttpError(409, "Publicá la actividad antes de subirla a Classroom: así el enlace ya funciona.", "not_published");
    if (await courseworkOf(activity.id)) throw new HttpError(409, "Esta actividad ya está en Classroom.", "already_linked");
    const body = await readJson(c, classroomPublishBody);
    const url = `${new URL(env.PUBLIC_URL).origin}/clase/${activity.linkToken}`;
    const description = [activity.instructions.trim(), `Entrá con este enlace y escribí tu nombre: ${url}`].filter(Boolean).join("\n\n");
    const graded = body.kind === "assignment";
    const created = await publishCoursework(t.id, {
      kind: body.kind,
      courseId: body.courseId,
      title: activity.title,
      description,
      url,
      maxPoints: graded ? body.maxPoints : null,
      dueDate: graded ? body.dueDate : null,
    });
    await db.insert(schema.classroomCourseworks).values({
      activityId: activity.id,
      kind: body.kind,
      courseId: body.courseId,
      courseName: created.courseName,
      courseworkId: created.courseworkId,
      url: created.url,
      maxPoints: graded ? body.maxPoints : null,
      createdBy: t.id,
    });
    await audit(c, t.id, "classroom_published", "activity", activity.id, { courseId: body.courseId, kind: body.kind });
    return c.json({ link: await courseworkOf(activity.id) }, 201);
  })

  // Forget the link (the assignment stays in Classroom).
  .delete("/activities/:activityId", async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    requireRole(activity, "edit");
    await db.delete(schema.classroomCourseworks).where(eq(schema.classroomCourseworks.activityId, activity.id));
    return c.json({ ok: true });
  })

  // Each work with the grade its rubric gives, and which Classroom student it is.
  .get("/activities/:activityId/grades", rateLimit("classroom-read", 120, 15 * 60_000, byTeacher), async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    const link = await gradedLink(activity.id);
    const [rows, list] = await Promise.all([
      db
        .select({
          sessionId: schema.learningSessions.id,
          studentId: schema.students.id,
          studentName: schema.students.fullName,
          snapshot: schema.rubricAssessments.rubricSnapshot,
          suggestion: schema.rubricAssessments.aiSuggestion,
          teacherLevels: schema.rubricAssessments.teacherLevels,
          status: schema.rubricAssessments.status,
          sentGrade: schema.classroomGrades.grade,
          sentReturned: schema.classroomGrades.returned,
          sentAt: schema.classroomGrades.syncedAt,
        })
        .from(schema.learningSessions)
        .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
        .leftJoin(schema.rubricAssessments, eq(schema.rubricAssessments.sessionId, schema.learningSessions.id))
        .leftJoin(schema.classroomGrades, eq(schema.classroomGrades.sessionId, schema.learningSessions.id))
        .where(eq(schema.learningSessions.activityId, activity.id))
        .orderBy(asc(schema.students.fullName)),
      roster(t.id, link.courseId),
    ]);
    const remembered = await rememberedMatches(link.courseId, rows.map((r) => r.studentId));
    const activityRubric = sanitizeRubric(activity.rubric);
    const out: ClassroomGradeRow[] = rows.map((r) => {
      const snap = sanitizeRubric(r.snapshot);
      const rubric = snap.length ? snap : activityRubric;
      const levels: Record<string, number | null> = {};
      for (const s of (Array.isArray(r.suggestion) ? r.suggestion : []) as { criterionId?: string; levelIndex?: number | null }[]) {
        if (s.criterionId) levels[s.criterionId] = typeof s.levelIndex === "number" ? s.levelIndex : null;
      }
      Object.assign(levels, (r.teacherLevels ?? {}) as Record<string, number>);
      const grade = gradeFromRubric(rubric, levels, link.maxPoints);
      const known = remembered.get(r.studentId);
      return {
        sessionId: r.sessionId,
        studentId: r.studentId,
        studentName: r.studentName,
        suggestedGrade: grade,
        source: grade === null ? null : r.status === "confirmed" ? "confirmed" : "suggested",
        userId: known && list.some((s) => s.userId === known) ? known : (matchStudent(r.studentName, list)?.userId ?? null),
        sent: r.sentGrade !== null && r.sentAt ? { grade: r.sentGrade, returned: r.sentReturned ?? false, at: r.sentAt.toISOString() } : null,
      };
    });
    const body: ClassroomGradesResponse = { link, rows: out, roster: list };
    return c.json(body);
  })

  // Sends the grades (and returns the works if asked); each one that fails says why.
  .post("/activities/:activityId/grades", rateLimit("classroom-write", 60, 15 * 60_000, byTeacher), async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    requireRole(activity, "edit");
    const link = await gradedLink(activity.id);
    const body = await readJson(c, classroomGradesBody);
    const own = await db
      .select({ id: schema.learningSessions.id, studentId: schema.learningSessions.studentId })
      .from(schema.learningSessions)
      .where(inArray(schema.learningSessions.id, body.items.map((i) => i.sessionId)));
    const studentOf = new Map(own.map((s) => [s.id, s.studentId]));
    const sessionsOfActivity = await db
      .select({ id: schema.learningSessions.id })
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.activityId, activity.id));
    const mine = new Set(sessionsOfActivity.map((s) => s.id));
    const subs = await submissions(t.id, link);
    const byUser = new Map(subs.map((s) => [s.userId, s]));
    const result: ClassroomGradesResult = { sent: 0, failed: [] };
    const matched: { studentId: string; userId: string }[] = [];
    for (const item of body.items) {
      if (!mine.has(item.sessionId)) {
        result.failed.push({ sessionId: item.sessionId, message: "Ese trabajo no es de esta actividad." });
        continue;
      }
      const sub = byUser.get(item.userId);
      if (!sub) {
        result.failed.push({ sessionId: item.sessionId, message: "Ese alumno no tiene la tarea en Classroom." });
        continue;
      }
      const grade = Math.min(item.grade, link.maxPoints);
      try {
        await gradeSubmission(t.id, link, sub.id, grade, body.returnToStudents);
        await db
          .insert(schema.classroomGrades)
          .values({ sessionId: item.sessionId, googleUserId: item.userId, grade, returned: body.returnToStudents })
          .onConflictDoUpdate({
            target: schema.classroomGrades.sessionId,
            set: { googleUserId: item.userId, grade, returned: body.returnToStudents, syncedAt: new Date() },
          });
        const studentId = studentOf.get(item.sessionId);
        if (studentId) matched.push({ studentId, userId: item.userId });
        result.sent++;
      } catch (err) {
        // A connection problem stops everything; anything else is about that one student.
        if (err instanceof HttpError && (err.code === "classroom_reconnect" || err.code === "classroom_not_connected" || err.code === "classroom_api_disabled")) throw err;
        result.failed.push({ sessionId: item.sessionId, message: err instanceof HttpError ? err.message : "No se pudo pasar la nota." });
      }
    }
    await rememberMatches(link.courseId, matched);
    await audit(c, t.id, "classroom_grades_sent", "activity", activity.id, { sent: result.sent, failed: result.failed.length });
    return c.json(result);
  });

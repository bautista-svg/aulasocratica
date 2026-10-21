import { Hono } from "hono";
import { and, asc, desc, eq, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { readJson, badRequest, notFound } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedClassroom, isUuid } from "../services/access";
import { audit } from "../services/audit";
import { deleteFile } from "../lib/storage";
import { reconcileReports } from "../services/reports/reconcile";
import {
  classroomBody,
  classroomPatch,
  addStudentsBody,
  renameStudentBody,
  type ClassroomSummary,
  type ClassroomStudent,
} from "@shared/contracts/classrooms";
import type { ActivitySummary } from "@shared/contracts/activities";
import { nameKey, tidyName } from "@shared/domain/names";
import { BUILTIN_ALERTS, LOCKED_ALERT_KEYS, builtinEnabled } from "@shared/domain/alerts";

const ACTIVE_MS = 2 * 60_000;

async function summaries(teacherId: string, where: ReturnType<typeof and>): Promise<ClassroomSummary[]> {
  const activeSince = new Date(Date.now() - ACTIVE_MS).toISOString();
  const rows = await db
    .select({
      c: schema.classrooms,
      activityCount: sql<number>`(select count(*)::int from activities a where a.classroom_id = classrooms.id)`,
      publishedCount: sql<number>`(select count(*)::int from activities a where a.classroom_id = classrooms.id and a.status = 'published')`,
      studentCount: sql<number>`(select count(*)::int from students s where s.classroom_id = classrooms.id)`,
      activeNow: sql<number>`(select count(*)::int from learning_sessions ls join activities a on a.id = ls.activity_id
        where a.classroom_id = classrooms.id and ls.status = 'in_progress' and ls.last_activity_at > ${activeSince}::timestamptz)`,
    })
    .from(schema.classrooms)
    .where(and(eq(schema.classrooms.teacherId, teacherId), where))
    .orderBy(desc(schema.classrooms.updatedAt));
  return rows.map(({ c, ...counts }) => ({
    id: c.id,
    name: c.name,
    school: c.school,
    subject: c.subject,
    grade: c.grade,
    division: c.division,
    description: c.description,
    isArchived: c.isArchived,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    ...counts,
  }));
}

export async function activitySummaries(teacherId: string, classroomId: string | null): Promise<ActivitySummary[]> {
  const activeSince = new Date(Date.now() - ACTIVE_MS).toISOString();
  const rows = await db
    .select({
      a: schema.activities,
      participants: sql<number>`(select count(*)::int from learning_sessions ls where ls.activity_id = activities.id)`,
      completed: sql<number>`(select count(*)::int from learning_sessions ls where ls.activity_id = activities.id and ls.status = 'completed')`,
      activeNow: sql<number>`(select count(*)::int from learning_sessions ls where ls.activity_id = activities.id and ls.status = 'in_progress' and ls.last_activity_at > ${activeSince}::timestamptz)`,
      openAlerts: sql<number>`(select count(*)::int from student_alerts sa where sa.activity_id = activities.id and sa.status = 'open')`,
    })
    .from(schema.activities)
    .where(and(eq(schema.activities.teacherId, teacherId), classroomId ? eq(schema.activities.classroomId, classroomId) : undefined))
    .orderBy(desc(schema.activities.updatedAt));
  return rows.map(({ a, ...counts }) => ({
    id: a.id,
    classroomId: a.classroomId,
    title: a.title,
    subject: a.subject,
    status: a.status as ActivitySummary["status"],
    linkActive: a.linkActive,
    startsAt: a.startsAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    ...counts,
  }));
}

const alertBody = z.object({
  name: z.string().trim().min(2, "Poné un nombre a la alerta.").max(80),
  description: z.string().trim().min(5, "Describí qué tiene que detectar.").max(400),
  category: z.enum(["academica", "conducta", "seguridad", "integridad"]),
  severity: z.enum(["review", "immediate"]),
});

export const classroomRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const archived = c.req.query("archived") === "1";
    const list = await summaries(teacherOf(c).id, and(eq(schema.classrooms.isArchived, archived)));
    return c.json({ classrooms: list });
  })

  .post("/", async (c) => {
    const body = await readJson(c, classroomBody);
    const t = teacherOf(c);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.classrooms).where(eq(schema.classrooms.teacherId, t.id));
    if ((count?.n ?? 0) >= 200) throw badRequest("Llegaste al máximo de 200 aulas. Archivá o borrá alguna para crear otra.");
    const [row] = await db.insert(schema.classrooms).values({ ...body, teacherId: t.id }).returning();
    const [summary] = await summaries(t.id, and(eq(schema.classrooms.id, row!.id)));
    return c.json({ classroom: summary }, 201);
  })

  .get("/:id", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const [summary] = await summaries(t.id, and(eq(schema.classrooms.id, room.id)));
    return c.json({ classroom: summary });
  })

  .patch("/:id", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const body = await readJson(c, classroomPatch);
    await db.update(schema.classrooms).set(body).where(eq(schema.classrooms.id, room.id));
    if (body.isArchived !== undefined) await audit(c, t.id, body.isArchived ? "classroom_archived" : "classroom_restored", "classroom", room.id);
    const [summary] = await summaries(t.id, and(eq(schema.classrooms.id, room.id)));
    return c.json({ classroom: summary });
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const acts = await db.select({ id: schema.activities.id }).from(schema.activities).where(eq(schema.activities.classroomId, room.id));
    const files = acts.length
      ? await db.select({ key: schema.activityFiles.storageKey }).from(schema.activityFiles).where(inArray(schema.activityFiles.activityId, acts.map((a) => a.id)))
      : [];
    const names = await db.select({ n: schema.students.fullName }).from(schema.students).where(eq(schema.students.classroomId, room.id));
    await db.delete(schema.classrooms).where(eq(schema.classrooms.id, room.id));
    await reconcileReports(t.id, names.map((x) => x.n));
    for (const f of files) await deleteFile(f.key);
    await audit(c, t.id, "classroom_deleted", "classroom", room.id, { activities: acts.length });
    return c.json({ ok: true });
  })

  .get("/:id/activities", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    return c.json({ activities: await activitySummaries(t.id, room.id) });
  })

  // ── Students (roster) ──
  .get("/:id/students", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const students = await db.select().from(schema.students).where(eq(schema.students.classroomId, room.id)).orderBy(asc(schema.students.fullName));
    const sessions = students.length
      ? await db
          .select({
            sessionId: schema.learningSessions.id,
            studentId: schema.learningSessions.studentId,
            activityId: schema.activities.id,
            activityTitle: schema.activities.title,
            status: schema.learningSessions.status,
            lastActivityAt: schema.learningSessions.lastActivityAt,
          })
          .from(schema.learningSessions)
          .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
          .where(eq(schema.activities.classroomId, room.id))
          .orderBy(desc(schema.learningSessions.lastActivityAt))
      : [];
    const byStudent = new Map<string, ClassroomStudent["sessions"]>();
    for (const s of sessions) {
      const list = byStudent.get(s.studentId) ?? [];
      list.push({ sessionId: s.sessionId, activityId: s.activityId, activityTitle: s.activityTitle, status: s.status, lastActivityAt: s.lastActivityAt.toISOString() });
      byStudent.set(s.studentId, list);
    }
    const out: ClassroomStudent[] = students.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      selfRegistered: s.selfRegistered,
      createdAt: s.createdAt.toISOString(),
      sessions: byStudent.get(s.id) ?? [],
    }));
    return c.json({ students: out });
  })

  .post("/:id/students", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const body = await readJson(c, addStudentsBody);
    const values = body.names
      .map((n) => ({ fullName: tidyName(n), nameKey: nameKey(n) }))
      .filter((v) => v.nameKey.length >= 2)
      .map((v) => ({ ...v, classroomId: room.id, selfRegistered: false }));
    const inserted = values.length
      ? await db.insert(schema.students).values(values).onConflictDoNothing().returning({ id: schema.students.id })
      : [];
    return c.json({ added: inserted.length, skipped: values.length - inserted.length });
  })

  .patch("/:id/students/:studentId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const studentId = c.req.param("studentId");
    if (!isUuid(studentId)) throw notFound("El alumno");
    const body = await readJson(c, renameStudentBody);
    const name = tidyName(body.fullName);
    const key = nameKey(name);
    const [clash] = await db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(and(eq(schema.students.classroomId, room.id), eq(schema.students.nameKey, key), sql`${schema.students.id} <> ${studentId}`))
      .limit(1);
    if (clash) throw badRequest("Ya hay un alumno con ese nombre en esta aula.", { fullName: "Nombre repetido." });
    const [row] = await db
      .update(schema.students)
      .set({ fullName: name, nameKey: key })
      .where(and(eq(schema.students.id, studentId), eq(schema.students.classroomId, room.id)))
      .returning();
    if (!row) throw notFound("El alumno");
    return c.json({ ok: true });
  })

  .delete("/:id/students/:studentId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const studentId = c.req.param("studentId");
    if (!isUuid(studentId)) throw notFound("El alumno");
    const [row] = await db
      .delete(schema.students)
      .where(and(eq(schema.students.id, studentId), eq(schema.students.classroomId, room.id)))
      .returning({ id: schema.students.id, fullName: schema.students.fullName });
    if (!row) throw notFound("El alumno");
    await reconcileReports(t.id, [row.fullName]);
    await audit(c, t.id, "student_deleted", "student", studentId);
    return c.json({ ok: true });
  })

  // ── Alerts configuration ──
  .get("/:id/alerts", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const rows = await db.select().from(schema.classroomAlerts).where(eq(schema.classroomAlerts.classroomId, room.id));
    const builtins = BUILTIN_ALERTS.map((a) => ({ ...a, enabled: builtinEnabled(a.key, rows) }));
    const custom = rows
      .filter((r) => !r.builtinKey)
      .map((r) => ({ id: r.id, name: r.name, description: r.description, category: r.category, severity: r.severity, enabled: r.enabled }));
    return c.json({ builtins, custom });
  })

  .put("/:id/alerts/builtin/:key", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const key = c.req.param("key");
    const def = BUILTIN_ALERTS.find((a) => a.key === key);
    if (!def) throw notFound("La alerta");
    if (LOCKED_ALERT_KEYS.includes(key)) throw badRequest("Las alertas de seguridad no se pueden desactivar.");
    const { enabled } = await readJson(c, z.object({ enabled: z.boolean() }));
    await db
      .insert(schema.classroomAlerts)
      .values({ classroomId: room.id, builtinKey: key, name: def.name, description: def.description, category: def.category, severity: def.severity, enabled })
      .onConflictDoUpdate({ target: [schema.classroomAlerts.classroomId, schema.classroomAlerts.builtinKey], set: { enabled } });
    return c.json({ ok: true });
  })

  .post("/:id/alerts", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const body = await readJson(c, alertBody);
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.classroomAlerts)
      .where(and(eq(schema.classroomAlerts.classroomId, room.id), sql`${schema.classroomAlerts.builtinKey} is null`));
    if ((n?.n ?? 0) >= 12) throw badRequest("Podés crear hasta 12 alertas propias por aula.");
    const [row] = await db.insert(schema.classroomAlerts).values({ ...body, classroomId: room.id, enabled: true }).returning();
    return c.json({ alert: row }, 201);
  })

  .patch("/:id/alerts/:alertId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const alertId = c.req.param("alertId");
    if (!isUuid(alertId)) throw notFound("La alerta");
    const body = await readJson(c, alertBody.partial().extend({ enabled: z.boolean().optional() }));
    const [row] = await db
      .update(schema.classroomAlerts)
      .set(body)
      .where(and(eq(schema.classroomAlerts.id, alertId), eq(schema.classroomAlerts.classroomId, room.id), sql`${schema.classroomAlerts.builtinKey} is null`))
      .returning();
    if (!row) throw notFound("La alerta");
    return c.json({ alert: row });
  })

  .delete("/:id/alerts/:alertId", async (c) => {
    const t = teacherOf(c);
    const room = await ownedClassroom(t.id, c.req.param("id"));
    const alertId = c.req.param("alertId");
    if (!isUuid(alertId)) throw notFound("La alerta");
    const [row] = await db
      .delete(schema.classroomAlerts)
      .where(and(eq(schema.classroomAlerts.id, alertId), eq(schema.classroomAlerts.classroomId, room.id), sql`${schema.classroomAlerts.builtinKey} is null`))
      .returning({ id: schema.classroomAlerts.id });
    if (!row) throw notFound("La alerta");
    return c.json({ ok: true });
  });

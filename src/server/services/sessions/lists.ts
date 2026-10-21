// Lists of students' works: the Radiografía page (paginated, completed first) and the
// page of one student (their works across the activities of their classroom).
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { isUuid } from "../access";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { XrayListItem, XrayListResponse } from "@shared/contracts/sessions";
import type { StudentDetail, StudentWork } from "@shared/contracts/students";
import { xrayCounts } from "./xray-store";

export const XRAY_PAGE_SIZE = 30;

interface Cursor {
  rank: number;
  ts: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    const tsOk = typeof c.ts === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/.test(c.ts);
    if ((c.rank === 0 || c.rank === 1) && tsOk && typeof c.id === "string" && isUuid(c.id)) return c;
  } catch {
    /* invalid */
  }
  throw badRequest("La página pedida no es válida. Volvé a cargar la lista.");
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function xrayList(
  teacherId: string,
  q: { classroomId?: string; activityId?: string; search?: string; cursor?: string },
): Promise<XrayListResponse> {
  const cursor = decodeCursor(q.cursor);
  const rank = sql<number>`(case when "learning_sessions"."status" = 'completed' then 0 else 1 end)`;
  const ts = sql`coalesce("learning_sessions"."completed_at", "learning_sessions"."last_activity_at")`;
  const where = and(
    eq(schema.activities.teacherId, teacherId),
    q.classroomId ? eq(schema.activities.classroomId, q.classroomId) : undefined,
    q.activityId ? eq(schema.activities.id, q.activityId) : undefined,
    q.search?.trim() ? ilike(schema.students.fullName, `%${escapeLike(q.search.trim().slice(0, 80))}%`) : undefined,
    cursor
      ? sql`(${rank} > ${cursor.rank} or (${rank} = ${cursor.rank} and (${ts} < ${cursor.ts}::timestamptz or (${ts} = ${cursor.ts}::timestamptz and "learning_sessions"."id" < ${cursor.id}::uuid))))`
      : undefined,
  );
  const rows = await db
    .select({
      s: schema.learningSessions,
      studentName: schema.students.fullName,
      activityTitle: schema.activities.title,
      classroomId: schema.classrooms.id,
      classroomName: schema.classrooms.name,
      rank,
      tsText: sql<string>`${ts}::text`,
      items: schema.thinkingAnalyses.items,
    })
    .from(schema.learningSessions)
    .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.activities.classroomId))
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .leftJoin(schema.thinkingAnalyses, eq(schema.thinkingAnalyses.sessionId, schema.learningSessions.id))
    .where(where)
    .orderBy(asc(rank), desc(ts), desc(schema.learningSessions.id))
    .limit(XRAY_PAGE_SIZE + 1);

  const page = rows.slice(0, XRAY_PAGE_SIZE);
  const items: XrayListItem[] = page.map((r) => {
    const counts = xrayCounts(r.items);
    return {
      sessionId: r.s.id,
      studentId: r.s.studentId,
      studentName: r.studentName,
      activityId: r.s.activityId,
      activityTitle: r.activityTitle,
      classroomId: r.classroomId,
      classroomName: r.classroomName,
      status: r.s.status === "completed" ? "completed" : "in_progress",
      endedByTeacher: r.s.endedByTeacher,
      startedAt: r.s.startedAt.toISOString(),
      lastActivityAt: r.s.lastActivityAt.toISOString(),
      completedAt: r.s.completedAt?.toISOString() ?? null,
      xray: { analyzed: r.items !== null, ...counts },
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > XRAY_PAGE_SIZE && last ? encodeCursor({ rank: Number(last.rank), ts: last.tsText, id: last.s.id }) : null,
  };
}

const preview = (s: string | null, max = 280) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export async function studentDetail(row: {
  student: typeof schema.students.$inferSelect;
  classroom: typeof schema.classrooms.$inferSelect;
}): Promise<StudentDetail> {
  const { student, classroom } = row;
  const sessions = await db
    .select({ s: schema.learningSessions, a: schema.activities })
    .from(schema.learningSessions)
    .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
    .where(and(eq(schema.learningSessions.studentId, student.id), eq(schema.activities.classroomId, classroom.id)))
    .orderBy(desc(schema.learningSessions.lastActivityAt));
  const ids = sessions.map((r) => r.s.id);
  const [alertCounts, activities] = await Promise.all([
    ids.length
      ? db
          .select({
            sessionId: schema.studentAlerts.sessionId,
            total: sql<number>`count(*)::int`,
            open: sql<number>`count(*) filter (where "student_alerts"."status" = 'open')::int`,
            immediate: sql<number>`count(*) filter (where "student_alerts"."status" = 'open' and "student_alerts"."severity" = 'immediate')::int`,
          })
          .from(schema.studentAlerts)
          .where(inArray(schema.studentAlerts.sessionId, ids))
          .groupBy(schema.studentAlerts.sessionId)
      : Promise.resolve([]),
    db
      .select({ id: schema.activities.id, title: schema.activities.title })
      .from(schema.activities)
      .where(and(eq(schema.activities.classroomId, classroom.id), eq(schema.activities.status, "published")))
      .orderBy(desc(schema.activities.publishedAt)),
  ]);
  const counts = new Map(alertCounts.map((r) => [r.sessionId, r]));
  const joined = new Set(sessions.map((r) => r.a.id));
  const works: StudentWork[] = sessions.map(({ s, a }) => {
    const c = counts.get(s.id);
    return {
      sessionId: s.id,
      activityId: a.id,
      activityTitle: a.title,
      activityStatus: a.status,
      requireInitialAnswer: a.requireInitialAnswer,
      status: s.status === "completed" ? "completed" : "in_progress",
      endedByTeacher: s.endedByTeacher,
      startedAt: s.startedAt.toISOString(),
      lastActivityAt: s.lastActivityAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      initialAnswerPreview: preview(s.initialAnswer),
      finalAnswerPreview: preview(s.finalAnswer),
      openAlerts: c?.open ?? 0,
      immediateAlerts: c?.immediate ?? 0,
      totalAlerts: c?.total ?? 0,
    };
  });
  return {
    student: { id: student.id, fullName: student.fullName, selfRegistered: student.selfRegistered, createdAt: student.createdAt.toISOString() },
    classroom: { id: classroom.id, name: classroom.name, label: classroomLabel(classroom), isArchived: classroom.isArchived },
    works,
    notJoined: activities.filter((a) => !joined.has(a.id)).map((a) => ({ activityId: a.id, title: a.title })),
  };
}

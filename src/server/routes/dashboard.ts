// Inicio: what is happening now in the teacher's classrooms (own and shared with them), what
// needs review and what to do next. Four queries in parallel; the onboarding checklist comes from
// real data.
import { Hono } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { activitySummaries } from "./classrooms";
import { visibleClassroomIds } from "../services/access";
import { activityState } from "@shared/domain/activity-state";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { DashboardResponse } from "@shared/contracts/dashboard";
import type { AlertSeverity } from "@shared/domain/alerts";

const RECENT = 6;
const ALERTS = 5;

type CountsRow = {
  classrooms: number;
  activities: number;
  published: number;
  students: number;
  open_alerts: number;
  has_classroom: boolean;
  has_activity: boolean;
  has_published: boolean;
  has_session: boolean;
};

/**
 * The open alerts to show first (immediate attention, then the most recent). The top ALERTS are
 * picked among the workspace's open alerts (partial index student_alerts_open_idx) BEFORE joining
 * the student's name, so the cost does not grow with every session of the database.
 */
async function latestOpenAlerts(teacherId: string) {
  const sa = schema.studentAlerts;
  const top = db
    .select({
      id: sa.id,
      sessionId: sa.sessionId,
      activityId: sa.activityId,
      activityTitle: schema.activities.title,
      name: sa.name,
      category: sa.category,
      severity: sa.severity,
      createdAt: sa.createdAt,
      rank: sql<number>`case when ${sa.severity} = 'immediate' then 0 else 1 end`.as("rank"),
    })
    .from(sa)
    .innerJoin(schema.activities, eq(schema.activities.id, sa.activityId))
    .where(and(sql`${schema.activities.classroomId} in ${visibleClassroomIds(teacherId)}`, isNull(schema.activities.deletedAt), eq(sa.status, "open")))
    // Immediate-attention alerts first, then the most recent.
    .orderBy(sql`case when ${sa.severity} = 'immediate' then 0 else 1 end`, desc(sa.createdAt))
    .limit(ALERTS)
    .as("top_alerts");
  return db
    .select({
      id: top.id,
      sessionId: top.sessionId,
      activityId: top.activityId,
      activityTitle: top.activityTitle,
      studentName: schema.students.fullName,
      name: top.name,
      category: top.category,
      severity: top.severity,
      createdAt: top.createdAt,
    })
    .from(top)
    .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, top.sessionId))
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .orderBy(top.rank, desc(top.createdAt));
}

export const dashboardRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const t = teacherOf(c);
    const mine = visibleClassroomIds(t.id);
    const [countsRows, activities, rooms, alerts] = await Promise.all([
      db.execute<CountsRow>(sql`
        with v as ${mine}
        select
          (select count(*)::int from classrooms c where c.id in (select id from v) and c.is_archived = false) as classrooms,
          (select count(*)::int from activities a join classrooms c on c.id = a.classroom_id
             where c.id in (select id from v) and c.is_archived = false and a.status <> 'archived') as activities,
          (select count(*)::int from activities a join classrooms c on c.id = a.classroom_id
             where c.id in (select id from v) and c.is_archived = false and a.status = 'published') as published,
          (select count(*)::int from students s join classrooms c on c.id = s.classroom_id
             where c.id in (select id from v) and c.is_archived = false) as students,
          (select count(*)::int from student_alerts sa join activities a on a.id = sa.activity_id
             where a.classroom_id in (select id from v) and sa.status = 'open') as open_alerts,
          exists(select 1 from v) as has_classroom,
          exists(select 1 from activities a where a.classroom_id in (select id from v)) as has_activity,
          exists(select 1 from activities a where a.classroom_id in (select id from v) and (a.status = 'published' or a.published_at is not null)) as has_published,
          exists(select 1 from learning_sessions ls join activities a on a.id = ls.activity_id where a.classroom_id in (select id from v)) as has_session`),
      activitySummaries(t.id, null),
      db
        .select({
          id: schema.classrooms.id,
          name: schema.classrooms.name,
          grade: schema.classrooms.grade,
          division: schema.classrooms.division,
          isArchived: schema.classrooms.isArchived,
        })
        .from(schema.classrooms)
        .where(sql`classrooms.id in ${mine}`)
        .orderBy(desc(schema.classrooms.updatedAt)),
      latestOpenAlerts(t.id),
    ]);

    const counts = Array.from(countsRows)[0]!;
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const visible = activities.filter((a) => roomById.get(a.classroomId)?.isArchived === false);
    const nameOf = (id: string) => {
      const r = roomById.get(id);
      return r ? classroomLabel(r) : "";
    };

    const live = visible
      .filter((a) => a.activeNow > 0 && activityState(a).open)
      .sort((a, b) => b.activeNow - a.activeNow)
      .map((a) => ({
        id: a.id,
        title: a.title,
        classroomId: a.classroomId,
        classroomName: nameOf(a.classroomId),
        activeNow: a.activeNow,
        participants: a.participants,
        completed: a.completed,
        openAlerts: a.openAlerts,
      }));

    const firstRoom = rooms.find((r) => !r.isArchived) ?? null;
    const draft = visible.find((a) => a.status === "draft") ?? null;
    const published = visible.find((a) => a.status === "published") ?? null;
    const onboarding = {
      hasClassroom: counts.has_classroom,
      hasActivity: counts.has_activity,
      hasPublished: counts.has_published,
      hasStudentSession: counts.has_session,
      classroomId: firstRoom?.id ?? null,
      draftActivityId: draft?.id ?? null,
      publishedActivityId: published?.id ?? null,
      done: counts.has_classroom && counts.has_activity && counts.has_published && counts.has_session,
    };

    const body: DashboardResponse = {
      workspace: { displayName: t.displayName, hasAccount: t.hasAccount },
      counts: {
        classrooms: counts.classrooms,
        activities: counts.activities,
        published: counts.published,
        students: counts.students,
        openAlerts: counts.open_alerts,
      },
      live,
      recent: visible.slice(0, RECENT).map((a) => ({ ...a, classroomName: nameOf(a.classroomId) })),
      alerts: alerts.map((a) => ({ ...a, severity: a.severity as AlertSeverity, createdAt: a.createdAt.toISOString() })),
      onboarding,
    };
    return c.json(body);
  });

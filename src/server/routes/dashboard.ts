// Inicio: what is happening now in the teacher's classrooms, what needs review and what to
// do next. Four queries in parallel; the onboarding checklist comes from real data.
import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { activitySummaries } from "./classrooms";
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

export const dashboardRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const t = teacherOf(c);
    const [countsRows, activities, rooms, alerts] = await Promise.all([
      db.execute<CountsRow>(sql`
        select
          (select count(*)::int from classrooms c where c.teacher_id = ${t.id} and c.is_archived = false) as classrooms,
          (select count(*)::int from activities a join classrooms c on c.id = a.classroom_id
             where a.teacher_id = ${t.id} and c.is_archived = false and a.status <> 'archived') as activities,
          (select count(*)::int from activities a join classrooms c on c.id = a.classroom_id
             where a.teacher_id = ${t.id} and c.is_archived = false and a.status = 'published') as published,
          (select count(*)::int from students s join classrooms c on c.id = s.classroom_id
             where c.teacher_id = ${t.id} and c.is_archived = false) as students,
          (select count(*)::int from student_alerts sa join activities a on a.id = sa.activity_id
             where a.teacher_id = ${t.id} and sa.status = 'open') as open_alerts,
          exists(select 1 from classrooms c where c.teacher_id = ${t.id}) as has_classroom,
          exists(select 1 from activities a where a.teacher_id = ${t.id}) as has_activity,
          exists(select 1 from activities a where a.teacher_id = ${t.id} and (a.status = 'published' or a.published_at is not null)) as has_published,
          exists(select 1 from learning_sessions ls join activities a on a.id = ls.activity_id where a.teacher_id = ${t.id}) as has_session`),
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
        .where(eq(schema.classrooms.teacherId, t.id))
        .orderBy(desc(schema.classrooms.updatedAt)),
      db
        .select({
          id: schema.studentAlerts.id,
          sessionId: schema.studentAlerts.sessionId,
          activityId: schema.studentAlerts.activityId,
          activityTitle: schema.activities.title,
          studentName: schema.students.fullName,
          name: schema.studentAlerts.name,
          category: schema.studentAlerts.category,
          severity: schema.studentAlerts.severity,
          createdAt: schema.studentAlerts.createdAt,
        })
        .from(schema.studentAlerts)
        .innerJoin(schema.activities, eq(schema.activities.id, schema.studentAlerts.activityId))
        .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, schema.studentAlerts.sessionId))
        .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
        .where(and(eq(schema.activities.teacherId, t.id), eq(schema.studentAlerts.status, "open")))
        // Immediate-attention alerts first, then the most recent.
        .orderBy(sql`case when ${schema.studentAlerts.severity} = 'immediate' then 0 else 1 end`, desc(schema.studentAlerts.createdAt))
        .limit(ALERTS),
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

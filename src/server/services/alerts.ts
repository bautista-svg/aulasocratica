// The alerts panel: every alert of the teacher's students, across their own classrooms and the
// ones shared with them (a reader sees them but cannot change their status).
// Open alerts needing immediate attention come first, then the rest of the open ones, then the
// reviewed or dismissed ones; newest first inside each group (keyset pagination).
import { and, desc, asc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { publish } from "../lib/events";
import { editableClassroomIds, isUuid, visibleClassroomIds } from "./access";
import { alertOrigin } from "./sessions/live-rules";
import { OBSERVED_ALERT_KEYS } from "@shared/domain/alerts";
import { deniedMessage } from "@shared/domain/sharing";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { AlertCountResponse, AlertInboxItem, AlertInboxQuery, AlertInboxResponse } from "@shared/contracts/alerts";
import type { AlertStatus } from "@shared/contracts/live";

export const ALERT_PAGE_SIZE = 40;

const sa = schema.studentAlerts;

interface Cursor {
  rank: number;
  ts: string;
  id: string;
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    const tsOk = typeof c.ts === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/.test(c.ts);
    if ([0, 1, 2].includes(c.rank) && tsOk && typeof c.id === "string" && isUuid(c.id)) return c;
  } catch {
    /* invalid */
  }
  throw badRequest("La página pedida no es válida. Volvé a cargar la lista.");
}

const RANK = sql<number>`(case when "student_alerts"."status" = 'open' and "student_alerts"."severity" = 'immediate' then 0
                               when "student_alerts"."status" = 'open' then 1 else 2 end)`;

/** Filters shared by the list and its counts (everything except the status). */
function scope(teacherId: string, q: Omit<AlertInboxQuery, "status" | "cursor">): SQL | undefined {
  return and(
    sql`${schema.activities.classroomId} in ${visibleClassroomIds(teacherId)}`,
    // Activities in the "Papelera" do not show their alerts.
    isNull(schema.activities.deletedAt),
    q.classroomId ? eq(schema.activities.classroomId, q.classroomId) : undefined,
    q.activityId ? eq(sa.activityId, q.activityId) : undefined,
    q.severity ? eq(sa.severity, q.severity) : undefined,
    q.origin === "observed" ? inArray(sa.alertKey, OBSERVED_ALERT_KEYS) : q.origin === "ai" ? notInArray(sa.alertKey, OBSERVED_ALERT_KEYS) : undefined,
  );
}

export async function alertInbox(teacherId: string, q: AlertInboxQuery): Promise<AlertInboxResponse> {
  const cursor = decodeCursor(q.cursor);
  const where = and(
    scope(teacherId, q),
    q.status === "all" ? undefined : eq(sa.status, q.status),
    cursor
      ? sql`(${RANK} > ${cursor.rank} or (${RANK} = ${cursor.rank} and ("student_alerts"."created_at" < ${cursor.ts}::timestamptz
             or ("student_alerts"."created_at" = ${cursor.ts}::timestamptz and "student_alerts"."id" < ${cursor.id}::uuid))))`
      : undefined,
  );

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        a: sa,
        rank: RANK,
        tsText: sql<string>`"student_alerts"."created_at"::text`,
        activityTitle: schema.activities.title,
        classroom: { id: schema.classrooms.id, name: schema.classrooms.name, grade: schema.classrooms.grade, division: schema.classrooms.division },
        studentId: schema.students.id,
        studentName: schema.students.fullName,
        canEdit: sql<boolean>`("activities"."classroom_id" in ${editableClassroomIds(teacherId)})`,
      })
      .from(sa)
      .innerJoin(schema.activities, eq(schema.activities.id, sa.activityId))
      .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.activities.classroomId))
      .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, sa.sessionId))
      .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
      .where(where)
      .orderBy(asc(RANK), desc(sa.createdAt), desc(sa.id))
      .limit(ALERT_PAGE_SIZE + 1),
    db
      .select({
        open: sql<number>`count(*) filter (where "student_alerts"."status" = 'open')::int`,
        immediate: sql<number>`count(*) filter (where "student_alerts"."status" = 'open' and "student_alerts"."severity" = 'immediate')::int`,
        reviewed: sql<number>`count(*) filter (where "student_alerts"."status" = 'reviewed')::int`,
        dismissed: sql<number>`count(*) filter (where "student_alerts"."status" = 'dismissed')::int`,
      })
      .from(sa)
      .innerJoin(schema.activities, eq(schema.activities.id, sa.activityId))
      .where(scope(teacherId, q)),
  ]);

  const page = rows.slice(0, ALERT_PAGE_SIZE);
  const items: AlertInboxItem[] = page.map((r) => ({
    id: r.a.id,
    sessionId: r.a.sessionId,
    activityId: r.a.activityId,
    activityTitle: r.activityTitle,
    classroomId: r.classroom.id,
    classroomLabel: classroomLabel(r.classroom),
    studentId: r.studentId,
    studentName: r.studentName,
    alertKey: r.a.alertKey,
    name: r.a.name,
    category: r.a.category,
    severity: r.a.severity === "immediate" ? "immediate" : "review",
    origin: alertOrigin(r.a.alertKey),
    evidence: r.a.evidence,
    reason: r.a.reason,
    status: r.a.status as AlertStatus,
    createdAt: r.a.createdAt.toISOString(),
    reviewedAt: r.a.reviewedAt?.toISOString() ?? null,
    canEdit: Boolean(r.canEdit),
  }));
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > ALERT_PAGE_SIZE && last ? encodeCursor({ rank: Number(last.rank), ts: last.tsText, id: last.a.id }) : null,
    counts: counts ?? { open: 0, immediate: 0, reviewed: 0, dismissed: 0 },
  };
}

export async function alertCount(teacherId: string): Promise<AlertCountResponse> {
  const [row] = await db
    .select({
      open: sql<number>`count(*)::int`,
      immediate: sql<number>`count(*) filter (where "student_alerts"."severity" = 'immediate')::int`,
    })
    .from(sa)
    .innerJoin(schema.activities, eq(schema.activities.id, sa.activityId))
    .where(and(sql`${schema.activities.classroomId} in ${visibleClassroomIds(teacherId)}`, isNull(schema.activities.deletedAt), eq(sa.status, "open")));
  return row ?? { open: 0, immediate: 0 };
}

/**
 * Sets the status of alerts of the teacher's activities, own or shared with the "edit" role (an id
 * from another workspace is simply not found; one of a classroom where they only read is a 403).
 * The live views of the affected activities are notified.
 */
export async function setAlertsStatus(teacherId: string, ids: string[], status: AlertStatus) {
  const unique = [...new Set(ids)].filter(isUuid);
  if (unique.length === 0) return [];
  const [readOnly] = await db
    .select({ id: sa.id })
    .from(sa)
    .innerJoin(schema.activities, eq(schema.activities.id, sa.activityId))
    .where(
      and(
        inArray(sa.id, unique),
        sql`${schema.activities.classroomId} in ${visibleClassroomIds(teacherId)}`,
        sql`${schema.activities.classroomId} not in ${editableClassroomIds(teacherId)}`,
      ),
    )
    .limit(1);
  if (readOnly) throw forbidden(deniedMessage("reader", "edit"));
  const owned = db
    .select({ id: schema.activities.id })
    .from(schema.activities)
    .where(sql`${schema.activities.classroomId} in ${editableClassroomIds(teacherId)}`);
  const rows = await db
    .update(sa)
    .set({ status, reviewedAt: status === "open" ? null : new Date() })
    .where(and(inArray(sa.id, unique), inArray(sa.activityId, owned)))
    .returning({ id: sa.id, activityId: sa.activityId, sessionId: sa.sessionId, status: sa.status, reviewedAt: sa.reviewedAt });
  const notified = new Set<string>();
  for (const r of rows) {
    const key = `${r.activityId}:${r.sessionId}`;
    if (notified.has(key)) continue;
    notified.add(key);
    publish(r.activityId, "alert", r.sessionId);
  }
  return rows;
}

export async function setAlertStatus(teacherId: string, alertId: string, status: AlertStatus) {
  if (!isUuid(alertId)) throw notFound("La alerta");
  const [row] = await setAlertsStatus(teacherId, [alertId], status);
  if (!row) throw notFound("La alerta");
  return { id: row.id, status: row.status as AlertStatus, reviewedAt: row.reviewedAt?.toISOString() ?? null };
}

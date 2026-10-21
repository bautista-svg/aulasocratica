// Teacher actions on students' work. Every change is announced to the live view.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { publish } from "../../lib/events";

/** Ends a student's work: they can no longer write (until the teacher lets them continue). */
export async function endSession(sessionId: string, activityId: string): Promise<boolean> {
  const now = new Date();
  const changed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.learningSessions)
      .set({ status: "completed", endedByTeacher: true, completedAt: now })
      .where(and(eq(schema.learningSessions.id, sessionId), eq(schema.learningSessions.status, "in_progress")))
      .returning({ id: schema.learningSessions.id });
    if (rows.length === 0) return false;
    await tx.insert(schema.pedagogicalEvents).values({ sessionId, eventType: "ended_by_teacher", source: "observed", details: { by: "teacher" } });
    return true;
  });
  if (changed) publish(activityId, "session", sessionId);
  return changed;
}

/** Lets the student continue a finished work (the original product had no way back). */
export async function reopenSession(sessionId: string, activityId: string): Promise<boolean> {
  const rows = await db
    .update(schema.learningSessions)
    .set({ status: "in_progress", endedByTeacher: false, completedAt: null })
    .where(and(eq(schema.learningSessions.id, sessionId), eq(schema.learningSessions.status, "completed")))
    .returning({ id: schema.learningSessions.id });
  if (rows.length) publish(activityId, "session", sessionId);
  return rows.length > 0;
}

/** Ends every work in progress of the activity. Returns how many were ended. */
export async function endAll(activityId: string): Promise<number> {
  const now = new Date();
  const ended = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.learningSessions)
      .set({ status: "completed", endedByTeacher: true, completedAt: now })
      .where(and(eq(schema.learningSessions.activityId, activityId), eq(schema.learningSessions.status, "in_progress")))
      .returning({ id: schema.learningSessions.id });
    if (rows.length) {
      await tx
        .insert(schema.pedagogicalEvents)
        .values(rows.map((r) => ({ sessionId: r.id, eventType: "ended_by_teacher", source: "observed", details: { by: "teacher", all: true } })));
    }
    return rows.map((r) => r.id);
  });
  if (ended.length) publish(activityId, "session");
  return ended.length;
}

/** Deletes the student's work in this activity (messages, events, evaluation, alerts cascade). */
export async function deleteSession(sessionId: string, activityId: string): Promise<boolean> {
  const rows = await db.delete(schema.learningSessions).where(eq(schema.learningSessions.id, sessionId)).returning({ id: schema.learningSessions.id });
  if (rows.length) publish(activityId, "session", sessionId);
  return rows.length > 0;
}

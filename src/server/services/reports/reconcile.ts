// Keeps saved reports consistent with deletions (students' right to erasure): after a
// student, a student's work, an activity or a classroom is deleted (or an activity reset),
// every report of the workspace is rebuilt from the database. Reports whose subject no
// longer exists are deleted, and teacher text that names a deleted student is redacted.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { log, errorFields } from "../../lib/logger";
import { readNarrative, type ReportKind } from "@shared/domain/reports";
import type { ReportScope } from "@shared/contracts/reports";
import { buildReport, scopeInputOf } from "./build";

const REDACTED = "[alumno eliminado]";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactNames(text: string, names: string[]): string {
  let out = text;
  for (const n of names) {
    const name = n.trim();
    if (name.length < 2) continue;
    out = out.replace(new RegExp(escapeRegExp(name), "gi"), REDACTED);
  }
  return out;
}

export async function reconcileReports(teacherId: string, removedStudentNames: string[] = []): Promise<void> {
  const reports = await db.select().from(schema.reports).where(eq(schema.reports.teacherId, teacherId));
  for (const r of reports) {
    try {
      const kind = r.kind as ReportKind;
      let built;
      try {
        built = await buildReport(teacherId, scopeInputOf(kind, r.scope as ReportScope));
      } catch {
        // Its student, activity or classroom no longer exists (or has no work left).
        await db.delete(schema.reports).where(eq(schema.reports.id, r.id));
        continue;
      }
      const narrative = readNarrative(kind, r.narrative);
      let touched = false;
      for (const k of Object.keys(narrative)) {
        const red = redactNames(narrative[k] ?? "", removedStudentNames);
        if (red !== narrative[k]) {
          narrative[k] = red;
          touched = true;
        }
      }
      await db
        .update(schema.reports)
        .set({
          data: built.data,
          scope: built.scope,
          narrative,
          ...(touched ? { status: "draft", validatedAt: null } : {}),
        })
        .where(eq(schema.reports.id, r.id));
    } catch (err) {
      log.warn("report_reconcile_failed", { reportId: r.id, ...errorFields(err) });
    }
  }
}

/** Students who have work in an activity (to detect which ones a reset removes). */
export async function studentsWithWork(activityId: string): Promise<{ id: string; fullName: string }[]> {
  return db
    .select({ id: schema.students.id, fullName: schema.students.fullName })
    .from(schema.learningSessions)
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .where(eq(schema.learningSessions.activityId, activityId));
}

/** Names of the given students that no longer exist. */
export async function namesRemoved(before: { id: string; fullName: string }[]): Promise<string[]> {
  if (!before.length) return [];
  const still = await db.select({ id: schema.students.id }).from(schema.students).where(inArray(schema.students.id, before.map((b) => b.id)));
  const alive = new Set(still.map((s) => s.id));
  return before.filter((b) => !alive.has(b.id)).map((b) => b.fullName);
}

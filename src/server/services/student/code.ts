// «Defensa de código»: whose code the tutor asks about. First the student's own (loaded by them or
// by the teacher); without it, the activity's material, for when the whole class defends the same
// thing or the teacher made one activity for one student.
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { DEFENSE_MAX_MESSAGES, cleanCodeFiles, isCodeDefense, type CodeFile } from "@shared/domain/code-defense";

type Activity = typeof schema.activities.$inferSelect;

/** When the tutor stops: the defense always ends by itself, inside the teacher's limit if there is one. */
export function defenseClosing(activity: Pick<Activity, "tutorType" | "extraTutorTypes" | "tutorMaxQuestions" | "tutorStopWhenAchieved">) {
  return isCodeDefense(activity)
    ? { maxQuestions: activity.tutorMaxQuestions ?? DEFENSE_MAX_MESSAGES, stopWhenAchieved: true }
    : { maxQuestions: activity.tutorMaxQuestions, stopWhenAchieved: activity.tutorStopWhenAchieved };
}

export function readCodeFiles(raw: unknown): CodeFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f: { name?: unknown; text?: unknown }) => (typeof f?.name === "string" && typeof f?.text === "string" ? [{ name: f.name, text: f.text }] : []));
}

export async function studentCode(activityId: string, studentId: string): Promise<CodeFile[]> {
  const [row] = await db
    .select({ files: schema.activityStudentCode.files })
    .from(schema.activityStudentCode)
    .where(and(eq(schema.activityStudentCode.activityId, activityId), eq(schema.activityStudentCode.studentId, studentId)));
  return readCodeFiles(row?.files);
}

export async function materialCode(activity: Pick<Activity, "id" | "material">): Promise<CodeFile[]> {
  const files = await db
    .select({ name: schema.activityFiles.fileName, text: schema.activityFiles.extractedText })
    .from(schema.activityFiles)
    .where(and(eq(schema.activityFiles.activityId, activity.id), eq(schema.activityFiles.processingStatus, "ready")))
    .orderBy(asc(schema.activityFiles.createdAt));
  const all = [...(activity.material.trim() ? [{ name: "material.txt", text: activity.material }] : []), ...files];
  // Material can be long or read from a PDF: what does not fit is left out rather than failing.
  const kept: CodeFile[] = [];
  for (const f of all) {
    const { files: ok } = cleanCodeFiles([...kept, f]);
    if (ok.length === kept.length + 1) kept.push(f);
  }
  return cleanCodeFiles(kept).files;
}

export async function defenseCode(activity: Pick<Activity, "id" | "material">, studentId: string): Promise<CodeFile[]> {
  const own = await studentCode(activity.id, studentId);
  return own.length ? own : materialCode(activity);
}

export async function hasDefenseCode(activity: Pick<Activity, "id" | "material">, studentId: string): Promise<boolean> {
  return (await defenseCode(activity, studentId)).length > 0;
}

export async function saveCode(activityId: string, studentId: string, files: CodeFile[], uploadedBy: "student" | "teacher") {
  await db
    .insert(schema.activityStudentCode)
    .values({ activityId, studentId, files, uploadedBy })
    .onConflictDoUpdate({
      target: [schema.activityStudentCode.activityId, schema.activityStudentCode.studentId],
      set: { files, uploadedBy, updatedAt: new Date() },
    });
}

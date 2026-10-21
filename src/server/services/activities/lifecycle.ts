// Creating, duplicating, resetting and deleting activities. Each operation either fully
// happens or leaves nothing half-done: database changes run in a transaction and files
// copied to disk for a failed operation are removed again.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { randomToken } from "../../lib/crypto";
import { copyFile, deleteFile, deletePrefix, newKey } from "../../lib/storage";
import { log, errorFields } from "../../lib/logger";
import { enqueueFile } from "../file-jobs";
import { configOf, ownsStorageKey } from "./data";
import { composeTutorRules } from "@shared/domain/tutors";
import { TUTOR_TYPES } from "@shared/domain/pedagogy";
import { DEFAULT_REFLECTION_QUESTIONS } from "@shared/domain/activity-design";
import { fileExtension } from "@shared/domain/files";

type ActivityRow = typeof schema.activities.$inferSelect;
type TutorRow = typeof schema.tutors.$inferSelect;

/** Max activities per classroom (keeps lists and exports bounded). */
export const MAX_ACTIVITIES_PER_CLASSROOM = 300;
const COPY_SUFFIX = " (copia)";

/** A new link token (url-safe, 128 bits). */
export const newLinkToken = () => randomToken(16);

/** The activity fields a saved tutor sets. Its texts land in the teacher-rules block. */
export function tutorConfig(t: TutorRow) {
  const helpLevel = ["autonomous", "moderate", "intensive"].includes(t.helpLevel) ? t.helpLevel : "moderate";
  return {
    tutorId: t.id,
    tutorType: t.tutorType in TUTOR_TYPES ? t.tutorType : "pensamiento_critico",
    helpLevel,
    tutorRules: composeTutorRules({
      student_age: t.studentAge,
      difficulty: t.difficulty,
      objectives: t.objectives,
      question_style: t.questionStyle,
      strategies: t.strategies,
      closing_criteria: t.closingCriteria,
      rules: t.rules,
    }),
  };
}

async function assertRoomForActivity(classroomId: string) {
  const [n] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.activities)
    .where(eq(schema.activities.classroomId, classroomId));
  if ((n?.n ?? 0) >= MAX_ACTIVITIES_PER_CLASSROOM) {
    throw badRequest(`Esta aula llegó al máximo de ${MAX_ACTIVITIES_PER_CLASSROOM} actividades. Borrá alguna que no uses para crear otra.`);
  }
}

export async function createActivity(input: {
  teacherId: string;
  classroom: typeof schema.classrooms.$inferSelect;
  title: string;
  tutor: TutorRow | null;
}): Promise<string> {
  if (input.classroom.isArchived) {
    throw badRequest("Esta aula está archivada. Restaurala para crear actividades.");
  }
  await assertRoomForActivity(input.classroom.id);
  const [row] = await db
    .insert(schema.activities)
    .values({
      classroomId: input.classroom.id,
      teacherId: input.teacherId,
      title: input.title,
      subject: input.classroom.subject.slice(0, 80),
      reflectionQuestions: DEFAULT_REFLECTION_QUESTIONS.map((q) => ({ ...q })),
      linkToken: newLinkToken(),
      ...(input.tutor ? tutorConfig(input.tutor) : {}),
    })
    .returning({ id: schema.activities.id });
  return row!.id;
}

export function copyTitle(title: string): string {
  return `${title.slice(0, 160 - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

/**
 * New draft with the same configuration and copies of the files (new storage keys; the
 * text already read is kept so the copy does not have to be processed again).
 */
export async function duplicateActivity(source: ActivityRow, targetClassroomId: string) {
  await assertRoomForActivity(targetClassroomId);
  const newId = randomUUID();
  const files = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, source.id));
  const copies: (typeof schema.activityFiles.$inferInsert)[] = [];
  let skipped = 0;
  for (const f of files) {
    const ext = fileExtension(path.basename(f.storageKey)) || fileExtension(f.fileName);
    const key = newKey("activities", newId, ext);
    try {
      await copyFile(f.storageKey, key);
    } catch (err) {
      skipped++;
      log.warn("activity_duplicate_file_missing", { activityId: source.id, fileId: f.id, ...errorFields(err) });
      continue;
    }
    const unfinished = f.processingStatus === "pending" || f.processingStatus === "processing";
    copies.push({
      activityId: newId,
      storageKey: key,
      fileName: f.fileName,
      mimeType: f.mimeType,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
      pageCount: f.pageCount,
      extractedText: f.extractedText,
      teacherNote: f.teacherNote,
      processingStatus: unfinished ? "pending" : f.processingStatus,
      processingError: unfinished ? null : f.processingError,
    });
  }
  let inserted: { id: string; processingStatus: string }[] = [];
  try {
    inserted = await db.transaction(async (tx) => {
      await tx.insert(schema.activities).values({
        id: newId,
        classroomId: targetClassroomId,
        teacherId: source.teacherId,
        title: copyTitle(source.title),
        ...configOf(source),
        status: "draft",
        linkToken: newLinkToken(),
      });
      return copies.length
        ? tx
            .insert(schema.activityFiles)
            .values(copies)
            .returning({ id: schema.activityFiles.id, processingStatus: schema.activityFiles.processingStatus })
        : [];
    });
  } catch (err) {
    await deletePrefix(`activities/${newId}`).catch(() => {});
    throw err;
  }
  for (const f of inserted) if (f.processingStatus === "pending") enqueueFile({ table: "activity_files", id: f.id });
  return { id: newId, copiedFiles: inserted.length, skippedFiles: skipped };
}

/**
 * "Reiniciar": removes every student's work in this activity (sessions cascade to
 * messages, events, assessments, analyses, summaries, alerts and device tokens) and the
 * self-registered students who are left without any work. Configuration, files and the
 * link stay (unless a new link is requested).
 */
export async function resetActivity(activity: ActivityRow, opts: { regenerateLink: boolean }) {
  return db.transaction(async (tx) => {
    const [counts] = (await tx.execute(sql`
      select
        (select count(*)::int from learning_sessions ls where ls.activity_id = ${activity.id}) as sessions,
        (select count(*)::int from messages m join learning_sessions ls on ls.id = m.session_id where ls.activity_id = ${activity.id}) as messages
    `)) as unknown as { sessions: number; messages: number }[];
    const removed = await tx
      .delete(schema.learningSessions)
      .where(eq(schema.learningSessions.activityId, activity.id))
      .returning({ studentId: schema.learningSessions.studentId });
    const touched = [...new Set(removed.map((r) => r.studentId))];
    let students = 0;
    if (touched.length) {
      const gone = await tx
        .delete(schema.students)
        .where(
          and(
            inArray(schema.students.id, touched),
            eq(schema.students.classroomId, activity.classroomId),
            eq(schema.students.selfRegistered, true),
            sql`not exists (select 1 from learning_sessions ls where ls.student_id = students.id)`,
          ),
        )
        .returning({ id: schema.students.id });
      students = gone.length;
    }
    let linkRegenerated = false;
    if (opts.regenerateLink) {
      await tx.update(schema.activities).set({ linkToken: newLinkToken() }).where(eq(schema.activities.id, activity.id));
      linkRegenerated = true;
    } else {
      // Touch updated_at so lists show the reset as a recent change.
      await tx.update(schema.activities).set({ updatedAt: new Date() }).where(eq(schema.activities.id, activity.id));
    }
    return {
      deleted: { sessions: counts?.sessions ?? removed.length, messages: counts?.messages ?? 0, students },
      linkRegenerated,
    };
  });
}

/** Deletes the activity (everything below it cascades) and its files on disk. */
export async function deleteActivity(activity: ActivityRow) {
  const files = await db
    .select({ key: schema.activityFiles.storageKey })
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.activityId, activity.id));
  const [sessions] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.learningSessions)
    .where(eq(schema.learningSessions.activityId, activity.id));
  await db.delete(schema.activities).where(eq(schema.activities.id, activity.id));
  for (const f of files) {
    if (ownsStorageKey(f.key)) await deleteFile(f.key).catch((err) => log.warn("file_delete_failed", errorFields(err)));
  }
  await deletePrefix(`activities/${activity.id}`).catch(() => {});
  return { files: files.length, sessions: sessions?.n ?? 0 };
}

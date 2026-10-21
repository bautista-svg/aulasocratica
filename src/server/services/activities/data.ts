// Reading activities and their files in the shape the editor uses.
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { notFound } from "../../lib/errors";
import { isUuid } from "../access";
import { sanitizeReflectionQuestions, sanitizeRubric } from "@shared/domain/activity-design";
import { isVoiceLanguage } from "@shared/domain/voice";
import { isDeliverableMode } from "@shared/domain/deliverables";
import type { ActivityEditorData, ActivityFile, ActivityStatus, HelpLevel } from "@shared/contracts/activities";
import type { FileKind, ProcessingStatus } from "@shared/domain/files";

type ActivityRow = typeof schema.activities.$inferSelect;

/** Fields copied when an activity is duplicated (everything the teacher configured). */
export function configOf(a: ActivityRow) {
  return {
    subject: a.subject,
    objectives: a.objectives,
    instructions: a.instructions,
    material: a.material,
    tutorType: a.tutorType,
    helpLevel: a.helpLevel,
    tutorRules: a.tutorRules,
    tutorId: a.tutorId,
    requireInitialAnswer: a.requireInitialAnswer,
    voiceLanguage: a.voiceLanguage,
    deliverableMode: a.deliverableMode,
    deliverablePrompt: a.deliverablePrompt,
    rubric: sanitizeRubric(a.rubric),
    reflectionQuestions: sanitizeReflectionQuestions(a.reflectionQuestions),
  };
}

/** The editor view of one activity of this teacher (404 when it is not theirs). */
export async function loadActivity(teacherId: string, activityId: string): Promise<ActivityEditorData> {
  if (!isUuid(activityId)) throw notFound("La actividad");
  const [row] = await db
    .select({
      a: schema.activities,
      classroomName: schema.classrooms.name,
      classroomArchived: schema.classrooms.isArchived,
      tutorName: schema.tutors.name,
      participants: sql<number>`(select count(*)::int from learning_sessions ls where ls.activity_id = activities.id)`,
      completed: sql<number>`(select count(*)::int from learning_sessions ls where ls.activity_id = activities.id and ls.status = 'completed')`,
    })
    .from(schema.activities)
    .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.activities.classroomId))
    .leftJoin(schema.tutors, eq(schema.tutors.id, schema.activities.tutorId))
    .where(and(eq(schema.activities.id, activityId), eq(schema.activities.teacherId, teacherId)))
    .limit(1);
  if (!row) throw notFound("La actividad");
  const a = row.a;
  return {
    id: a.id,
    classroomId: a.classroomId,
    classroomName: row.classroomName,
    classroomArchived: row.classroomArchived,
    title: a.title,
    subject: a.subject,
    objectives: a.objectives,
    instructions: a.instructions,
    material: a.material,
    tutorType: a.tutorType,
    helpLevel: a.helpLevel as HelpLevel,
    tutorRules: a.tutorRules,
    tutorId: a.tutorId,
    tutorName: row.tutorName ?? null,
    requireInitialAnswer: a.requireInitialAnswer,
    voiceLanguage: isVoiceLanguage(a.voiceLanguage) ? a.voiceLanguage : "off",
    deliverableMode: isDeliverableMode(a.deliverableMode) ? a.deliverableMode : "off",
    deliverablePrompt: a.deliverablePrompt,
    rubric: sanitizeRubric(a.rubric),
    reflectionQuestions: sanitizeReflectionQuestions(a.reflectionQuestions),
    status: a.status as ActivityStatus,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    linkToken: a.linkToken,
    linkActive: a.linkActive,
    startsAt: a.startsAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    participants: row.participants,
    completed: row.completed,
  };
}

// Everything but the (possibly huge) extracted text, plus its length.
const fileColumns = {
  id: schema.activityFiles.id,
  activityId: schema.activityFiles.activityId,
  storageKey: schema.activityFiles.storageKey,
  fileName: schema.activityFiles.fileName,
  mimeType: schema.activityFiles.mimeType,
  kind: schema.activityFiles.kind,
  sizeBytes: schema.activityFiles.sizeBytes,
  pageCount: schema.activityFiles.pageCount,
  processingStatus: schema.activityFiles.processingStatus,
  processingError: schema.activityFiles.processingError,
  teacherNote: schema.activityFiles.teacherNote,
  textChars: sql<number>`char_length(${schema.activityFiles.extractedText})::int`,
  createdAt: schema.activityFiles.createdAt,
  updatedAt: schema.activityFiles.updatedAt,
};

type FileRow = {
  id: string;
  activityId: string;
  fileName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  pageCount: number | null;
  processingStatus: string;
  processingError: string | null;
  teacherNote: string;
  textChars: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Reading failures that another try cannot fix (the file itself is the problem): damaged or
 * protected PDF, unreadable Word, image too big, file gone from the volume. Matched by the start of
 * the stored message (services/extract.ts and file-jobs.ts write them).
 */
const PERMANENT_FAILURES = [
  "No pudimos abrir este PDF",
  "No pudimos leer este documento de Word",
  "Este documento de Word es demasiado grande",
  "La imagen pesa más de",
  "El archivo ya no está en el servidor",
];

export function isRetryableFailure(error: string | null): boolean {
  if (!error) return true;
  return !PERMANENT_FAILURES.some((p) => error.startsWith(p));
}

export function toFile(f: FileRow): ActivityFile {
  return {
    id: f.id,
    activityId: f.activityId,
    fileName: f.fileName,
    mimeType: f.mimeType,
    kind: f.kind as FileKind,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
    processingStatus: f.processingStatus as ProcessingStatus,
    processingError: f.processingError,
    textChars: f.textChars,
    teacherNote: f.teacherNote,
    retryable: f.processingStatus === "failed" ? isRetryableFailure(f.processingError) : false,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export async function listFiles(activityId: string): Promise<ActivityFile[]> {
  const rows = await db
    .select(fileColumns)
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.activityId, activityId))
    .orderBy(asc(schema.activityFiles.createdAt));
  return rows.map(toFile);
}

/** One file of an activity (404 when it belongs to another activity). */
export async function fileOf(activityId: string, fileId: string) {
  if (!isUuid(fileId)) throw notFound("El archivo");
  const [row] = await db
    .select(fileColumns)
    .from(schema.activityFiles)
    .where(and(eq(schema.activityFiles.id, fileId), eq(schema.activityFiles.activityId, activityId)))
    .limit(1);
  if (!row) throw notFound("El archivo");
  return row;
}

/**
 * Files that count toward MAX_FILES_PER_ACTIVITY: the ones that could not be read do not (the
 * teacher removes them or uploads another version). `total` bounds how many rows pile up anyway.
 */
export async function fileCount(activityId: string): Promise<{ usable: number; total: number }> {
  const [r] = await db
    .select({
      usable: sql<number>`(count(*) filter (where ${schema.activityFiles.processingStatus} <> 'failed'))::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.activityId, activityId));
  return { usable: r?.usable ?? 0, total: r?.total ?? 0 };
}

/** Files we may remove from disk: only copies that live under activities/ (never a library original). */
export function ownsStorageKey(key: string): boolean {
  return key.startsWith("activities/");
}

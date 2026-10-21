// Student deliverables ("entrega"): the one file a student hands in with the final answer, when
// the activity asks for it. Uploading again replaces it (until the work is sent). The file is
// stored under the activity's folder (so deleting the activity or its classroom removes it) and
// read in the background like any upload; the teacher can then analyze it with the rubric.
import type { Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { HttpError, badRequest } from "../lib/errors";
import { deleteFile, newKey, saveFile } from "../lib/storage";
import { hit } from "../lib/rate-limit";
import { publish } from "../lib/events";
import { log, errorFields } from "../lib/logger";
import { assertStorageRoom } from "./quota";
import { enqueueFile } from "./file-jobs";
import { safeFileName } from "./activities/files";
import { isReadOnly, readOnlyError, recordEvent, type StudentCtx } from "./student/session";
import { streamStoredFile } from "./student/files";
import { isDeliverableMode, validateDeliverable } from "@shared/domain/deliverables";

const sd = schema.sessionDeliverables;

/** Uploads per work (a student trying a few photos is fine; a loop is not). */
export const DELIVERABLE_UPLOAD_LIMIT = { perSession: 12, windowMs: 10 * 60_000 };

const deliverableGone = () => new HttpError(404, "Este archivo ya no está disponible.", "not_found");

export async function deliverableOf(sessionId: string) {
  const [row] = await db.select().from(sd).where(eq(sd.sessionId, sessionId)).limit(1);
  return row ?? null;
}

export async function saveDeliverable(ctx: StudentCtx, file: File | undefined): Promise<void> {
  if (isReadOnly(ctx.session)) throw readOnlyError(ctx.session);
  const mode = isDeliverableMode(ctx.activity.deliverableMode) ? ctx.activity.deliverableMode : "off";
  if (mode === "off") throw badRequest("Esta actividad no pide un archivo.");
  if (!file) throw badRequest("Elegí un archivo.");
  if (!hit(`s_deliverable:${ctx.session.id}`, DELIVERABLE_UPLOAD_LIMIT.perSession, DELIVERABLE_UPLOAD_LIMIT.windowMs)) {
    throw new HttpError(429, "Subiste muchos archivos seguidos. Esperá unos minutos y probá de nuevo.", "rate_limited");
  }
  const fileName = safeFileName(file.name);
  const check = validateDeliverable({ name: fileName, type: file.type, size: file.size });
  if (!check.ok) throw badRequest(check.error, { file: check.error });
  await assertStorageRoom(ctx.activity.teacherId, file.size);

  const previous = await deliverableOf(ctx.session.id);
  const key = newKey("activities", ctx.activity.id, check.ext);
  await saveFile(key, new Uint8Array(await file.arrayBuffer()));
  let rowId: string;
  try {
    const values = {
      storageKey: key,
      fileName,
      mimeType: check.mime,
      kind: check.kind,
      sizeBytes: file.size,
      pageCount: null,
      extractedText: "",
      processingStatus: "pending",
      processingError: null,
      analysis: null,
      analyzedAt: null,
    };
    const [row] = await db
      .insert(sd)
      .values({ ...values, sessionId: ctx.session.id, activityId: ctx.activity.id })
      .onConflictDoUpdate({ target: sd.sessionId, set: { ...values, updatedAt: new Date() } })
      .returning({ id: sd.id });
    rowId = row!.id;
  } catch (err) {
    await deleteFile(key).catch(() => {});
    throw err;
  }
  if (previous && previous.storageKey !== key) {
    await deleteFile(previous.storageKey).catch((err) => log.warn("deliverable_old_file_delete_failed", errorFields(err)));
  }
  await db.update(schema.learningSessions).set({ lastActivityAt: new Date() }).where(eq(schema.learningSessions.id, ctx.session.id));
  await recordEvent(ctx.session.id, "deliverable_uploaded", { kind: check.kind, sizeBytes: file.size, replaced: Boolean(previous) });
  publish(ctx.activity.id, "session", ctx.session.id);
  enqueueFile({ table: "session_deliverables", id: rowId });
}

export async function removeDeliverable(ctx: StudentCtx): Promise<void> {
  if (isReadOnly(ctx.session)) throw readOnlyError(ctx.session);
  const rows = await db.delete(sd).where(eq(sd.sessionId, ctx.session.id)).returning({ key: sd.storageKey });
  if (!rows.length) return;
  await deleteStoredKeys(rows.map((r) => r.key));
  await recordEvent(ctx.session.id, "deliverable_removed");
  publish(ctx.activity.id, "session", ctx.session.id);
}

/** The student's own file (their device session). */
export async function serveStudentDeliverable(c: Context, sessionId: string, download: boolean): Promise<Response> {
  const row = await deliverableOf(sessionId);
  if (!row) throw deliverableGone();
  return streamStoredFile(c, row, download, deliverableGone);
}

/** For the teacher (the session was already resolved as theirs). */
export async function serveTeacherDeliverable(c: Context, sessionId: string, download: boolean): Promise<Response> {
  return serveStudentDeliverable(c, sessionId, download);
}

/** Storage keys of the deliverables that are about to be deleted with their works. */
export async function deliverableKeys(where: { sessionIds?: string[]; activityId?: string; studentId?: string }): Promise<string[]> {
  if (where.sessionIds) {
    if (!where.sessionIds.length) return [];
    return (await db.select({ key: sd.storageKey }).from(sd).where(inArray(sd.sessionId, where.sessionIds))).map((r) => r.key);
  }
  if (where.activityId) return (await db.select({ key: sd.storageKey }).from(sd).where(eq(sd.activityId, where.activityId))).map((r) => r.key);
  if (where.studentId) {
    const rows = await db
      .select({ key: sd.storageKey })
      .from(sd)
      .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, sd.sessionId))
      .where(eq(schema.learningSessions.studentId, where.studentId));
    return rows.map((r) => r.key);
  }
  return [];
}

export async function deleteStoredKeys(keys: string[]): Promise<void> {
  for (const key of keys) await deleteFile(key).catch((err) => log.warn("deliverable_file_delete_failed", errorFields(err)));
}

/** A failed reading of the teacher's own student's file can be tried again. */
export async function retryDeliverable(sessionId: string): Promise<boolean> {
  const [row] = await db
    .update(sd)
    .set({ processingStatus: "pending", processingError: null })
    .where(and(eq(sd.sessionId, sessionId), eq(sd.processingStatus, "failed")))
    .returning({ id: sd.id });
  if (row) enqueueFile({ table: "session_deliverables", id: row.id });
  return Boolean(row);
}

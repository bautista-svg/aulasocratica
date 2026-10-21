// Copies a library material into an activity ("self-contained copy" semantics: later edits
// or deletion of the library item never change the activity).
// - Files are copied on disk into activity_files (already-read text is copied too; files
//   still being read are processed again for the copy).
// - Texts and links are appended to the activity's written material, never overwriting it.
//   Texts longer than MAX_TEXT_FOR_ACTIVITY become a text file of the activity instead, so
//   nothing is cut.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { HttpError, badRequest, conflict } from "../../lib/errors";
import { copyFile, deleteFile, newKey, saveFile } from "../../lib/storage";
import { enqueueFile } from "../file-jobs";
import { MAX_FILES_PER_ACTIVITY, fileExtension } from "@shared/domain/files";
import { MAX_TEXT_FOR_ACTIVITY, appendMaterialText, materialAsActivityText } from "@shared/domain/library";

type MaterialRow = typeof schema.materials.$inferSelect;

export interface AttachResult {
  attachedAs: "file" | "text";
  processing: boolean;
}

async function fileCount(activityId: string): Promise<number> {
  const [n] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.activityId, activityId));
  return n?.n ?? 0;
}

async function assertFileRoom(activityId: string) {
  if ((await fileCount(activityId)) >= MAX_FILES_PER_ACTIVITY) {
    throw conflict(`La actividad ya tiene ${MAX_FILES_PER_ACTIVITY} archivos, el máximo. Quitá alguno para sumar otro.`);
  }
}

/** Appends text to activities.material under a row lock (two attaches at once never lose text). */
export async function appendToActivityMaterial(activityId: string, block: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ material: string }>(sql`select material from activities where id = ${activityId} for update`);
    if (!row) throw new HttpError(404, "La actividad no existe o no tenés acceso.", "not_found");
    await tx
      .update(schema.activities)
      .set({ material: appendMaterialText(row.material, block) })
      .where(eq(schema.activities.id, activityId));
  });
}

export async function attachMaterialToActivity(m: MaterialRow, activityId: string): Promise<AttachResult> {
  if (m.kind === "link") {
    await appendToActivityMaterial(activityId, materialAsActivityText(m));
    return { attachedAs: "text", processing: false };
  }

  if (m.kind === "text") {
    if (m.body.trim().length <= MAX_TEXT_FOR_ACTIVITY) {
      await appendToActivityMaterial(activityId, materialAsActivityText(m));
      return { attachedAs: "text", processing: false };
    }
    await assertFileRoom(activityId);
    const key = newKey("activities", activityId, "txt");
    const data = new TextEncoder().encode(m.body);
    await saveFile(key, data);
    try {
      await db.insert(schema.activityFiles).values({
        activityId,
        storageKey: key,
        fileName: `${m.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 150) || "Texto"}.txt`,
        mimeType: "text/plain",
        kind: "text",
        sizeBytes: data.byteLength,
        extractedText: m.body,
        processingStatus: "ready",
      });
    } catch (err) {
      await deleteFile(key);
      throw err;
    }
    return { attachedAs: "file", processing: false };
  }

  // kind === "file"
  if (!m.storageKey || !m.fileKind) throw badRequest(`«${m.title}» no tiene un archivo guardado.`);
  if (m.processingStatus === "failed") {
    throw badRequest(`No pudimos leer «${m.title}». Reintentá la lectura en Mis materiales o subilo en otro formato.`);
  }
  await assertFileRoom(activityId);
  const ext = fileExtension(m.storageKey) || fileExtension(m.fileName ?? "");
  const key = newKey("activities", activityId, ext);
  try {
    await copyFile(m.storageKey, key);
  } catch {
    throw new HttpError(500, `No se pudo copiar «${m.title}». Probá de nuevo.`, "copy_failed");
  }
  const ready = m.processingStatus === "ready";
  let fileId: string;
  try {
    const [row] = await db
      .insert(schema.activityFiles)
      .values({
        activityId,
        storageKey: key,
        fileName: m.fileName ?? m.title,
        mimeType: m.mimeType ?? "application/octet-stream",
        kind: m.fileKind,
        sizeBytes: m.sizeBytes ?? 0,
        pageCount: m.pageCount,
        extractedText: ready ? m.extractedText : "",
        processingStatus: ready ? "ready" : "pending",
        processingError: ready ? m.processingError : null,
      })
      .returning({ id: schema.activityFiles.id });
    fileId = row!.id;
  } catch (err) {
    await deleteFile(key);
    throw err;
  }
  if (!ready) enqueueFile({ table: "activity_files", id: fileId });
  return { attachedAs: "file", processing: !ready };
}

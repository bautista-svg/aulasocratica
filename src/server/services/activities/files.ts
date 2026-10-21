// Activity files: multipart uploads, removal and text preview. Uploads are saved to the
// volume and processed in the background (file-jobs); the request never waits for the
// reading to finish. There is no page limit: long PDFs are read page by page.
import type { Context } from "hono";
import { eq, sql, and } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { badRequest } from "../../lib/errors";
import { deleteFile, newKey, saveFile } from "../../lib/storage";
import { log, errorFields } from "../../lib/logger";
import { enqueueFile } from "../file-jobs";
import { fileCount, listFiles, ownsStorageKey } from "./data";
import { MAX_FILES_PER_ACTIVITY, validateUpload } from "@shared/domain/files";
import type { UploadFilesResponse } from "@shared/contracts/activities";

/** All `file` parts of a multipart request (one or many). */
export async function readFileParts(c: Context, field = "file"): Promise<File[]> {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  } catch {
    throw badRequest("No pudimos leer el archivo enviado. Probá de nuevo.");
  }
  const raw = body[field];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
}

/** A display name without folders or control characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "archivo";
  if (clean.length <= 200) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
  return clean.slice(0, 200 - ext.length) + ext;
}

export async function saveActivityUploads(activityId: string, files: File[]): Promise<UploadFilesResponse> {
  if (files.length === 0) throw badRequest("Elegí al menos un archivo.");
  let count = await fileCount(activityId);
  const rejected: UploadFilesResponse["rejected"] = [];
  const createdIds: string[] = [];
  for (const file of files) {
    const fileName = safeFileName(file.name);
    const check = validateUpload({ name: fileName, type: file.type, size: file.size });
    if (!check.ok) {
      rejected.push({ fileName, error: check.error });
      continue;
    }
    if (count >= MAX_FILES_PER_ACTIVITY) {
      rejected.push({ fileName, error: `"${fileName}": la actividad ya tiene ${MAX_FILES_PER_ACTIVITY} archivos, el máximo. Quitá alguno para sumar otro.` });
      continue;
    }
    const key = newKey("activities", activityId, check.ext);
    try {
      await saveFile(key, new Uint8Array(await file.arrayBuffer()));
      const [row] = await db
        .insert(schema.activityFiles)
        .values({
          activityId,
          storageKey: key,
          fileName,
          mimeType: check.mime,
          kind: check.kind,
          sizeBytes: file.size,
          processingStatus: "pending",
        })
        .returning({ id: schema.activityFiles.id });
      createdIds.push(row!.id);
      count++;
    } catch (err) {
      log.error("activity_file_save_failed", { activityId, ...errorFields(err) });
      await deleteFile(key).catch(() => {});
      rejected.push({ fileName, error: `"${fileName}": no se pudo guardar. Probá de nuevo.` });
    }
  }
  for (const id of createdIds) enqueueFile({ table: "activity_files", id });
  if (createdIds.length === 0) {
    throw badRequest(rejected[0]?.error ?? "No se pudo subir ningún archivo.");
  }
  const all = await listFiles(activityId);
  const created = new Set(createdIds);
  return { files: all.filter((f) => created.has(f.id)), rejected };
}

export async function removeActivityFile(activityId: string, fileId: string, storageKey: string) {
  await db
    .delete(schema.activityFiles)
    .where(and(eq(schema.activityFiles.id, fileId), eq(schema.activityFiles.activityId, activityId)));
  if (ownsStorageKey(storageKey)) await deleteFile(storageKey).catch((err) => log.warn("file_delete_failed", errorFields(err)));
}

export async function retryActivityFile(fileId: string) {
  await db
    .update(schema.activityFiles)
    .set({ processingStatus: "pending", processingError: null })
    .where(eq(schema.activityFiles.id, fileId));
  enqueueFile({ table: "activity_files", id: fileId });
}

export const TEXT_PAGE_DEFAULT = 20_000;
export const TEXT_PAGE_MAX = 100_000;

/** A window of the extracted text (by characters), without loading the whole text. */
export async function fileTextPage(fileId: string, offset: number, limit: number) {
  const [row] = await db
    .select({
      total: sql<number>`char_length(${schema.activityFiles.extractedText})::int`,
      text: sql<string>`substr(${schema.activityFiles.extractedText}, ${offset + 1}::int, ${limit}::int)`,
      // Postgres counts characters (not UTF-16 units like JS), so the next offset comes from it too.
      got: sql<number>`char_length(substr(${schema.activityFiles.extractedText}, ${offset + 1}::int, ${limit}::int))::int`,
    })
    .from(schema.activityFiles)
    .where(eq(schema.activityFiles.id, fileId))
    .limit(1);
  const total = row?.total ?? 0;
  const text = row?.text ?? "";
  const end = offset + (row?.got ?? 0);
  return { text, offset, limit, total, nextOffset: end < total ? end : null };
}

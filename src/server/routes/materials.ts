// "Mis materiales": the teacher's library of files, written texts and links. Files are read in
// the background (no page limit) and can be copied into any activity.
import { Readable } from "node:stream";
import { Hono } from "hono";
import { assertStorageRoom } from "../services/quota";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { readJson, badRequest, tooMany, HttpError } from "../lib/errors";
import { hit } from "../lib/rate-limit";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedActivity, ownedMaterial } from "../services/access";
import { audit } from "../services/audit";
import { enqueueFile } from "../services/file-jobs";
import { attachMaterialToActivity } from "../services/planning/attach";
import { once } from "../services/activities/idempotency";
import { isRetryableFailure } from "../services/activities/data";
import { deleteFile, fileSize, fileStream, newKey, saveFile } from "../lib/storage";
import { attachmentHeader } from "../lib/pdf";
import { log } from "../lib/logger";
import {
  attachMaterialBody,
  createMaterialBody,
  updateMaterialBody,
  type AttachResponse,
  type MaterialDetail,
  type MaterialListResponse,
  type MaterialSummary,
  type MaterialTextPage,
  type UploadResponse,
} from "@shared/contracts/materials";
import { validateUpload, type FileKind, type ProcessingStatus } from "@shared/domain/files";
import { MAX_MATERIALS, PREVIEW_PAGE_CHARS, sanitizeFolder, sanitizeTags, titleFromFileName, type MaterialKind } from "@shared/domain/library";

const m = schema.materials;

/** Columns for lists: never the body or the extracted text (they can be megabytes). */
const summaryColumns = {
  id: m.id,
  title: m.title,
  kind: m.kind,
  fileKind: m.fileKind,
  fileName: m.fileName,
  mimeType: m.mimeType,
  sizeBytes: m.sizeBytes,
  pageCount: m.pageCount,
  url: m.url,
  folder: m.folder,
  tags: m.tags,
  processingStatus: m.processingStatus,
  processingError: m.processingError,
  textChars: sql<number>`(case when materials.kind = 'file' then char_length(materials.extracted_text) else char_length(materials.body) end)::int`,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
};

const summaryQuery = () => db.select(summaryColumns).from(m);
type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];

function toSummary(r: SummaryRow): MaterialSummary {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as MaterialKind,
    fileKind: (r.fileKind as FileKind | null) ?? null,
    fileName: r.fileName ?? null,
    mimeType: r.mimeType ?? null,
    sizeBytes: r.sizeBytes ?? null,
    pageCount: r.pageCount ?? null,
    url: r.url ?? null,
    folder: r.folder,
    tags: r.tags ?? [],
    processingStatus: r.processingStatus as ProcessingStatus,
    processingError: r.processingError ?? null,
    retryable: r.processingStatus === "failed" ? isRetryableFailure(r.processingError ?? null) : false,
    textChars: Number(r.textChars ?? 0),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function summaryOf(teacherId: string, id: string): Promise<MaterialSummary> {
  const [row] = await summaryQuery()
    .where(and(eq(m.teacherId, teacherId), eq(m.id, id)))
    .limit(1);
  if (!row) throw new HttpError(404, "El material no existe o no tenés acceso.", "not_found");
  return toSummary(row);
}

async function detailOf(teacherId: string, id: string): Promise<MaterialDetail> {
  const summary = await summaryOf(teacherId, id);
  const [row] = await db.select({ body: m.body }).from(m).where(eq(m.id, id)).limit(1);
  return { ...summary, body: summary.kind === "file" ? "" : (row?.body ?? "") };
}

async function materialCount(teacherId: string): Promise<number> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(m).where(eq(m.teacherId, teacherId));
  return n?.n ?? 0;
}

async function assertRoom(teacherId: string, adding: number) {
  const n = await materialCount(teacherId);
  if (n + adding > MAX_MATERIALS) {
    throw badRequest(
      n >= MAX_MATERIALS
        ? `Llegaste al máximo de ${MAX_MATERIALS} materiales. Borrá los que ya no uses para sumar otros.`
        : `Podés sumar ${MAX_MATERIALS - n} materiales más (el máximo es ${MAX_MATERIALS}).`,
    );
  }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Strips control characters and path separators from a file name shown to the teacher. */
const tidyFileName = (name: string) =>
  name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^.*[\\/]/, "")
    .trim()
    .slice(0, 200) || "archivo";

export const materialRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const t = teacherOf(c);
    const q = (c.req.query("q") ?? "").trim().slice(0, 120);
    const folder = c.req.query("folder");
    const tag = (c.req.query("tag") ?? "").trim().toLowerCase();
    const conds: (SQL | undefined)[] = [eq(m.teacherId, t.id)];
    if (folder !== undefined) conds.push(eq(m.folder, sanitizeFolder(folder)));
    if (tag) conds.push(sql`${tag} = any(materials.tags)`);
    if (q) {
      const like = `%${likeEscape(q)}%`;
      conds.push(sql`(materials.title ilike ${like} or materials.folder ilike ${like} or coalesce(materials.file_name, '') ilike ${like}
        or array_to_string(materials.tags, ' ') ilike ${like} or materials.body ilike ${like} or materials.extracted_text ilike ${like})`);
    }
    const rows = await summaryQuery()
      .where(and(...conds))
      .orderBy(desc(m.updatedAt))
      .limit(MAX_MATERIALS);
    const folders = await db
      .select({ name: m.folder, count: sql<number>`count(*)::int` })
      .from(m)
      .where(and(eq(m.teacherId, t.id), sql`materials.folder <> ''`))
      .groupBy(m.folder)
      .orderBy(asc(m.folder));
    const tags = await db.execute<{ name: string; count: number }>(sql`
      select tag as name, count(*)::int as count
      from materials, unnest(materials.tags) as tag
      where materials.teacher_id = ${t.id}
      group by tag order by count(*) desc, tag asc limit 60`);
    const res: MaterialListResponse = {
      materials: rows.map(toSummary),
      folders,
      tags: [...tags].map((r) => ({ name: r.name, count: Number(r.count) })),
      total: await materialCount(t.id),
      limit: MAX_MATERIALS,
    };
    return c.json(res);
  })

  // Several `file` parts (+ optional `folder`, `tags`). Each file is saved and read in the background.
  .post("/files", async (c) => {
    const t = teacherOf(c);
    if (!hit(`library-upload:${t.id}`, 200, 60 * 60_000)) throw tooMany("Subiste muchos archivos seguidos. Esperá unos minutos y probá de nuevo.");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("No pudimos recibir los archivos. Probá de nuevo.");
    }
    const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
    if (!files.length) throw badRequest("Elegí al menos un archivo.");
    await assertRoom(t.id, files.length);
    await assertStorageRoom(t.id, files.reduce((n, f) => n + f.size, 0));
    const folder = sanitizeFolder(String(form.get("folder") ?? ""));
    const tags = sanitizeTags(String(form.get("tags") ?? ""));

    const created: MaterialSummary[] = [];
    const rejected: UploadResponse["rejected"] = [];
    for (const file of files) {
      const name = tidyFileName(file.name);
      const check = validateUpload({ name, type: file.type, size: file.size }, { allowAudio: true });
      if (!check.ok) {
        rejected.push({ fileName: name, message: check.error });
        continue;
      }
      const key = newKey("library", t.id, check.ext);
      await saveFile(key, new Uint8Array(await file.arrayBuffer()));
      try {
        const [row] = await db
          .insert(m)
          .values({
            teacherId: t.id,
            title: titleFromFileName(name),
            kind: "file",
            fileKind: check.kind,
            storageKey: key,
            fileName: name,
            mimeType: check.mime,
            sizeBytes: file.size,
            processingStatus: "pending",
            folder,
            tags,
          })
          .returning({ id: m.id });
        enqueueFile({ table: "materials", id: row!.id });
        created.push(await summaryOf(t.id, row!.id));
      } catch (err) {
        await deleteFile(key);
        throw err;
      }
    }
    if (!created.length) throw badRequest(rejected.map((r) => r.message).join(" "));
    log.info("library_upload", { teacherId: t.id, files: created.length, rejected: rejected.length });
    const res: UploadResponse = { materials: created, rejected };
    return c.json(res, 201);
  })

  .post("/", async (c) => {
    const t = teacherOf(c);
    const body = await readJson(c, createMaterialBody);
    // A double click or a retry with the same request id returns the material created the first time.
    const material = await once("material", t.id, body.requestId, body, async () => {
      await assertRoom(t.id, 1);
      const [row] = await db
        .insert(m)
        .values({
          teacherId: t.id,
          title: body.title,
          kind: body.kind,
          url: body.kind === "link" ? body.url : null,
          body: body.body,
          processingStatus: "ready",
          folder: sanitizeFolder(body.folder),
          tags: sanitizeTags(body.tags),
        })
        .returning({ id: m.id });
      return detailOf(t.id, row!.id);
    });
    return c.json({ material }, 201);
  })

  .get("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    return c.json({ material: await detailOf(t.id, row.id) });
  })

  .patch("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    const body = await readJson(c, updateMaterialBody);
    const set: Partial<typeof m.$inferInsert> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.folder !== undefined) set.folder = sanitizeFolder(body.folder);
    if (body.tags !== undefined) set.tags = sanitizeTags(body.tags);
    if (body.body !== undefined) {
      if (row.kind === "file") throw badRequest("El texto de un archivo sale del archivo: no se puede editar acá.");
      if (row.kind === "text" && !body.body.trim()) throw badRequest("Revisá los datos ingresados.", { body: "Escribí el texto." });
      if (row.kind === "link" && body.body.length > 2000) throw badRequest("Revisá los datos ingresados.", { body: "Usá hasta 2000 caracteres." });
      set.body = body.body;
    }
    if (body.url !== undefined) {
      if (row.kind !== "link") throw badRequest("Solo los enlaces tienen dirección web.");
      set.url = body.url;
    }
    if (Object.keys(set).length) await db.update(m).set(set).where(and(eq(m.id, row.id), eq(m.teacherId, t.id)));
    return c.json({ material: await detailOf(t.id, row.id) });
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    await db.delete(m).where(and(eq(m.id, row.id), eq(m.teacherId, t.id)));
    await deleteFile(row.storageKey);
    await audit(c, t.id, "material_deleted", "material", row.id, { kind: row.kind });
    return c.json({ ok: true });
  })

  .post("/:id/retry", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    if (row.kind !== "file" || !row.storageKey) throw badRequest("Solo se puede volver a leer un archivo.");
    if (row.processingStatus === "ready") throw badRequest("Este archivo ya se leyó.");
    await db.update(m).set({ processingStatus: "pending", processingError: null }).where(eq(m.id, row.id));
    enqueueFile({ table: "materials", id: row.id });
    return c.json({ material: await summaryOf(t.id, row.id) });
  })

  .get("/:id/download", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    if (row.kind !== "file" || !row.storageKey) throw badRequest("Este material no es un archivo.");
    const size = await fileSize(row.storageKey);
    if (size === null) throw new HttpError(404, "No encontramos el archivo guardado. Subilo de nuevo.", "file_missing");
    const stream = Readable.toWeb(fileStream(row.storageKey)) as unknown as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": row.mimeType ?? "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": attachmentHeader(row.fileName ?? row.title),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })

  // Paged preview of what the AI and the tutor read ("lo que se leyó del archivo").
  .get("/:id/text", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset") ?? 0)) || 0);
    const limit = Math.min(50_000, Math.max(1000, Math.floor(Number(c.req.query("limit") ?? PREVIEW_PAGE_CHARS)) || PREVIEW_PAGE_CHARS));
    const col = row.kind === "file" ? sql`materials.extracted_text` : sql`materials.body`;
    const [r] = await db.execute<{ text: string; total: number }>(
      sql`select substr(${col}, ${offset + 1}, ${limit}) as text, char_length(${col})::int as total from materials where id = ${row.id}`,
    );
    const res: MaterialTextPage = { text: r?.text ?? "", offset, limit, total: Number(r?.total ?? 0), pageCount: row.pageCount };
    return c.json(res);
  })

  .post("/:id/attach", async (c) => {
    const t = teacherOf(c);
    const row = await ownedMaterial(t.id, c.req.param("id"));
    const { activityId } = await readJson(c, attachMaterialBody);
    const activity = await ownedActivity(t.id, activityId);
    const r = await attachMaterialToActivity(row, activity.id);
    const res: AttachResponse = { attachedAs: r.attachedAs, activityId: activity.id, processing: r.processing };
    return c.json(res);
  });

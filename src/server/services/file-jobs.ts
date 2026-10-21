// Background processing of uploaded files (activity files and library materials).
// Status goes pending → processing → ready | failed; a crash mid-way is recovered at boot
// (rows stuck in "processing" go back to "pending") and the teacher can always retry.
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { db, schema } from "../db/client";
import { readFile } from "../lib/storage";
import { extractFile } from "./extract";
import { HttpError } from "../lib/errors";
import { log, errorFields } from "../lib/logger";
import { registerJob } from "../jobs";
import type { FileKind } from "@shared/domain/files";

type Target = { table: "activity_files" | "materials"; id: string };

const queue: Target[] = [];
const active = new Set<string>();
let running = 0;
const CONCURRENCY = 2;

export function enqueueFile(target: Target) {
  const key = `${target.table}:${target.id}`;
  if (active.has(key) || queue.some((q) => q.table === target.table && q.id === target.id)) return;
  queue.push(target);
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const next = queue.shift()!;
    const key = `${next.table}:${next.id}`;
    running++;
    active.add(key);
    void processTarget(next)
      .catch((err) => log.error("file_job_crashed", { id: next.id, ...errorFields(err) }))
      .finally(() => {
        running--;
        active.delete(key);
        pump();
      });
  }
}

function failureMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return "El archivo ya no está en el servidor. Quitalo y subilo de nuevo.";
  return "No se pudo leer el archivo. Probá de nuevo o subilo en otro formato.";
}

async function processTarget(t: Target) {
  if (t.table === "activity_files") {
    const [row] = await db
      .select({ file: schema.activityFiles, teacherId: schema.activities.teacherId })
      .from(schema.activityFiles)
      .innerJoin(schema.activities, eq(schema.activities.id, schema.activityFiles.activityId))
      .where(eq(schema.activityFiles.id, t.id))
      .limit(1);
    if (!row || row.file.processingStatus === "ready") return;
    await db.update(schema.activityFiles).set({ processingStatus: "processing", processingError: null }).where(eq(schema.activityFiles.id, t.id));
    try {
      const data = await readFile(row.file.storageKey);
      const r = await extractFile({
        data,
        kind: row.file.kind as FileKind,
        mime: row.file.mimeType,
        ctx: { purpose: "file_extraction", teacherId: row.teacherId, activityId: row.file.activityId },
      });
      await db
        .update(schema.activityFiles)
        .set({ processingStatus: "ready", extractedText: r.text, pageCount: r.pageCount, processingError: r.note })
        .where(eq(schema.activityFiles.id, t.id));
    } catch (err) {
      log.warn("file_processing_failed", { table: t.table, id: t.id, ...errorFields(err) });
      await db
        .update(schema.activityFiles)
        .set({ processingStatus: "failed", processingError: failureMessage(err) })
        .where(eq(schema.activityFiles.id, t.id));
    }
    return;
  }

  const [m] = await db.select().from(schema.materials).where(eq(schema.materials.id, t.id)).limit(1);
  if (!m || !m.storageKey || m.processingStatus === "ready") return;
  await db.update(schema.materials).set({ processingStatus: "processing", processingError: null }).where(eq(schema.materials.id, t.id));
  try {
    const data = await readFile(m.storageKey);
    const r = await extractFile({
      data,
      kind: (m.fileKind ?? "text") as FileKind,
      mime: m.mimeType ?? "",
      ctx: { purpose: "file_extraction", teacherId: m.teacherId },
    });
    await db
      .update(schema.materials)
      .set({ processingStatus: "ready", extractedText: r.text, pageCount: r.pageCount, processingError: r.note })
      .where(eq(schema.materials.id, t.id));
  } catch (err) {
    log.warn("file_processing_failed", { table: t.table, id: t.id, ...errorFields(err) });
    await db.update(schema.materials).set({ processingStatus: "failed", processingError: failureMessage(err) }).where(eq(schema.materials.id, t.id));
  }
}

/** Waits until the given file is no longer pending/processing (used by synchronous flows and tests). */
export async function waitForFile(t: Target, timeoutMs = 120_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const table = t.table === "activity_files" ? schema.activityFiles : schema.materials;
    const [row] = await db.select({ s: table.processingStatus }).from(table).where(eq(table.id, t.id)).limit(1);
    if (!row || row.s === "ready" || row.s === "failed") return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Recovery: anything left pending/processing for more than a minute is picked up again.
registerJob({
  name: "resume_file_processing",
  everyMs: 60_000,
  run: async () => {
    const stale = new Date(Date.now() - 60_000);
    const files = await db
      .select({ id: schema.activityFiles.id })
      .from(schema.activityFiles)
      .where(
        and(
          inArray(schema.activityFiles.processingStatus, ["pending", "processing"]),
          or(lt(schema.activityFiles.updatedAt, stale), eq(schema.activityFiles.processingStatus, "pending")),
        ),
      )
      .limit(50);
    const mats = await db
      .select({ id: schema.materials.id })
      .from(schema.materials)
      .where(
        and(
          inArray(schema.materials.processingStatus, ["pending", "processing"]),
          or(lt(schema.materials.updatedAt, stale), eq(schema.materials.processingStatus, "pending")),
        ),
      )
      .limit(50);
    for (const f of files) enqueueFile({ table: "activity_files", id: f.id });
    for (const m of mats) enqueueFile({ table: "materials", id: m.id });
  },
});

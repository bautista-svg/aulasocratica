// Background processing of uploaded files (activity files, library materials and the files
// students hand in with their work).
// Status goes pending → processing → ready | failed; a crash mid-way is recovered at boot
// (rows stuck in "processing" go back to "pending") and the teacher can always retry.
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { readFile } from "../lib/storage";
import { extractFile } from "./extract";
import { readLinkForJob } from "./link-reader";
import { HttpError } from "../lib/errors";
import { log, errorFields } from "../lib/logger";
import { registerJob } from "../jobs";
import type { FileKind } from "@shared/domain/files";

type Target = { table: "activity_files" | "materials" | "session_deliverables"; id: string };

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

  if (t.table === "session_deliverables") {
    const sd = schema.sessionDeliverables;
    const [row] = await db
      .select({ file: sd, teacherId: schema.activities.teacherId })
      .from(sd)
      .innerJoin(schema.activities, eq(schema.activities.id, sd.activityId))
      .where(eq(sd.id, t.id))
      .limit(1);
    if (!row || row.file.processingStatus === "ready") return;
    const f = row.file;
    // Replaced meanwhile (the student handed in something else): this reading is for the old one.
    const unchanged = and(eq(sd.id, t.id), f.storageKey ? eq(sd.storageKey, f.storageKey) : eq(sd.url, f.url ?? ""));
    await db.update(sd).set({ processingStatus: "processing", processingError: null }).where(eq(sd.id, t.id));
    try {
      // A link is read from Google (only public Google links get here); a file from storage.
      const file =
        f.kind === "link"
          ? await readLinkForJob(f.url ?? "")
          : { data: await readFile(f.storageKey ?? ""), kind: f.kind as FileKind, mime: f.mimeType };
      const r = await extractFile({
        data: file.data,
        kind: file.kind,
        mime: file.mime,
        ctx: { purpose: "file_extraction", teacherId: row.teacherId, activityId: f.activityId },
      });
      await db
        .update(sd)
        .set({ processingStatus: "ready", extractedText: r.text, pageCount: r.pageCount, processingError: r.note })
        .where(unchanged);
    } catch (err) {
      log.warn("file_processing_failed", { table: t.table, id: t.id, ...errorFields(err) });
      await db.update(sd).set({ processingStatus: "failed", processingError: failureMessage(err) }).where(unchanged);
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
    const table = t.table === "activity_files" ? schema.activityFiles : t.table === "materials" ? schema.materials : schema.sessionDeliverables;
    const [row] = await db.select({ s: table.processingStatus }).from(table).where(eq(table.id, t.id)).limit(1);
    if (!row || row.s === "ready" || row.s === "failed") return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Recovery. "pending" rows (queued but not started, e.g. before a restart) are picked up again.
// A row left in "processing" means a previous attempt was interrupted mid-way: it is marked
// failed instead of retried automatically, so a file that crashes the reader can never cause
// a restart loop. The teacher can retry it by hand.
const INTERRUPTED = "La lectura se interrumpió. Tocá «Reintentar»; si vuelve a fallar, subilo en otro formato (por ejemplo PDF).";

registerJob({
  name: "resume_file_processing",
  everyMs: 60_000,
  run: async () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const interruptedFiles = await db
      .select({ id: schema.activityFiles.id })
      .from(schema.activityFiles)
      .where(and(eq(schema.activityFiles.processingStatus, "processing"), lt(schema.activityFiles.updatedAt, stale)))
      .limit(50);
    for (const f of interruptedFiles) {
      if (active.has(`activity_files:${f.id}`)) continue;
      await db.update(schema.activityFiles).set({ processingStatus: "failed", processingError: INTERRUPTED }).where(eq(schema.activityFiles.id, f.id));
    }
    const interruptedMats = await db
      .select({ id: schema.materials.id })
      .from(schema.materials)
      .where(and(eq(schema.materials.processingStatus, "processing"), lt(schema.materials.updatedAt, stale)))
      .limit(50);
    for (const m of interruptedMats) {
      if (active.has(`materials:${m.id}`)) continue;
      await db.update(schema.materials).set({ processingStatus: "failed", processingError: INTERRUPTED }).where(eq(schema.materials.id, m.id));
    }

    const sd = schema.sessionDeliverables;
    const interruptedDeliverables = await db
      .select({ id: sd.id })
      .from(sd)
      .where(and(eq(sd.processingStatus, "processing"), lt(sd.updatedAt, stale)))
      .limit(50);
    for (const d of interruptedDeliverables) {
      if (active.has(`session_deliverables:${d.id}`)) continue;
      await db.update(sd).set({ processingStatus: "failed", processingError: INTERRUPTED }).where(eq(sd.id, d.id));
    }

    const files = await db
      .select({ id: schema.activityFiles.id })
      .from(schema.activityFiles)
      .where(eq(schema.activityFiles.processingStatus, "pending"))
      .limit(50);
    const mats = await db.select({ id: schema.materials.id }).from(schema.materials).where(eq(schema.materials.processingStatus, "pending")).limit(50);
    for (const f of files) enqueueFile({ table: "activity_files", id: f.id });
    for (const m of mats) enqueueFile({ table: "materials", id: m.id });
    const pendingDeliverables = await db.select({ id: sd.id }).from(sd).where(eq(sd.processingStatus, "pending")).limit(50);
    for (const d of pendingDeliverables) enqueueFile({ table: "session_deliverables", id: d.id });
  },
});

/** At boot nothing can be running yet: anything still "processing" was interrupted by the restart. */
export async function markInterruptedAtBoot(): Promise<void> {
  await db
    .update(schema.activityFiles)
    .set({ processingStatus: "failed", processingError: INTERRUPTED })
    .where(eq(schema.activityFiles.processingStatus, "processing"));
  await db
    .update(schema.materials)
    .set({ processingStatus: "failed", processingError: INTERRUPTED })
    .where(eq(schema.materials.processingStatus, "processing"));
  await db
    .update(schema.sessionDeliverables)
    .set({ processingStatus: "failed", processingError: INTERRUPTED })
    .where(eq(schema.sessionDeliverables.processingStatus, "processing"));
}

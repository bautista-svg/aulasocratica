import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { call, newTeacher, newClassroom } from "./helpers";
import { db, schema } from "@server/db/client";
import { waitForFile } from "@server/services/file-jobs";
import { fileSize, readFile } from "@server/lib/storage";
import { MAX_FILES_PER_ACTIVITY } from "@shared/domain/files";
import { aiMock } from "./ai-mock";

async function setup() {
  const t = await newTeacher();
  const room = await newClassroom(t.cookie);
  const r = await call("POST", "/api/activities", { cookie: t.cookie, body: { classroomId: room, title: "El ciclo del agua" } });
  expect(r.status).toBe(201);
  return { cookie: t.cookie, room, id: r.body.activity.id as string, token: r.body.activity.linkToken as string };
}

function formWith(...files: File[]) {
  const f = new FormData();
  for (const file of files) f.append("file", file);
  return f;
}

async function upload(cookie: string, activityId: string, ...files: File[]) {
  return call("POST", `/api/activities/${activityId}/files`, { cookie, form: formWith(...files) });
}

async function uploadReady(cookie: string, activityId: string, file: File) {
  const r = await upload(cookie, activityId, file);
  expect(r.status).toBe(201);
  const id = r.body.files[0].id as string;
  await waitForFile({ table: "activity_files", id });
  return id;
}

async function textLayerPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Pagina ${i} de ${pages}. El ciclo del agua incluye evaporacion, condensacion y precipitacion.`, { x: 40, y: 780, size: 11, font });
    page.drawText(`Segunda linea de la pagina ${i}: el agua vuelve a los rios y al mar.`, { x: 40, y: 760, size: 11, font });
  }
  return doc.save();
}

async function storageKey(fileId: string) {
  const [row] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.id, fileId));
  return row!.storageKey;
}

describe("activity files", () => {
  it("reads a 120-page text PDF completely (no page limit) and serves its text by pages of characters", async () => {
    const { cookie, id } = await setup();
    const bytes = await textLayerPdf(120);
    const r = await upload(cookie, id, new File([new Uint8Array(bytes)], "Manual del agua.pdf", { type: "application/pdf" }));
    expect(r.status).toBe(201);
    expect(r.body.rejected).toEqual([]);
    const file = r.body.files[0];
    expect(file.kind).toBe("pdf");
    expect(file.fileName).toBe("Manual del agua.pdf");
    expect(file.sizeBytes).toBe(bytes.byteLength);
    expect(["pending", "processing", "ready"]).toContain(file.processingStatus);

    await waitForFile({ table: "activity_files", id: file.id });
    const list = await call("GET", `/api/activities/${id}/files`, { cookie });
    const ready = list.body.files[0];
    expect(ready.processingStatus).toBe("ready");
    expect(ready.pageCount).toBe(120);
    expect(ready.processingError).toBeNull();
    expect(ready.textChars).toBeGreaterThan(120 * 60);

    // Paginate through the extracted text in small windows.
    let offset = 0;
    let all = "";
    for (let guard = 0; guard < 100; guard++) {
      const page = await call("GET", `/api/activities/${id}/files/${file.id}/text?offset=${offset}&limit=5000`, { cookie });
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(ready.textChars);
      all += page.body.text;
      if (page.body.nextOffset === null) break;
      offset = page.body.nextOffset;
    }
    expect(all).toHaveLength(ready.textChars);
    expect(all).toContain("[Página 1]");
    expect(all).toContain("[Página 120]");
    expect(all).toContain("Pagina 120 de 120");

    const dl = await call("GET", `/api/activities/${id}/files/${file.id}/download`, { cookie });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment; filename="Manual del agua.pdf"/);
    const inline = await call("GET", `/api/activities/${id}/files/${file.id}/download?inline=1`, { cookie });
    expect(inline.headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("rejects unsupported types with a clear message and accepts the valid part of a mixed upload", async () => {
    const { cookie, id } = await setup();
    const exe = await upload(cookie, id, new File(["MZ"], "juego.exe", { type: "application/octet-stream" }));
    expect(exe.status).toBe(400);
    expect(exe.body.error.message).toMatch(/se aceptan PDF/);
    const doc = await upload(cookie, id, new File(["x"], "viejo.doc", { type: "application/msword" }));
    expect(doc.status).toBe(400);
    expect(doc.body.error.message).toMatch(/\.docx/);
    const empty = await call("POST", `/api/activities/${id}/files`, { cookie, form: new FormData() });
    expect(empty.status).toBe(400);

    const mixed = await upload(cookie, id, new File(["apuntes"], "apuntes.txt", { type: "text/plain" }), new File(["x"], "foto.heic", { type: "image/heic" }));
    expect(mixed.status).toBe(201);
    expect(mixed.body.files).toHaveLength(1);
    expect(mixed.body.rejected).toHaveLength(1);
    expect(mixed.body.rejected[0].error).toMatch(/HEIC/);
  });

  it(`stops at ${MAX_FILES_PER_ACTIVITY} files per activity`, async () => {
    const { cookie, id } = await setup();
    await db.insert(schema.activityFiles).values(
      Array.from({ length: MAX_FILES_PER_ACTIVITY }, (_, i) => ({
        activityId: id,
        storageKey: `activities/${id}/fake-${i}.txt`,
        fileName: `f${i}.txt`,
        mimeType: "text/plain",
        kind: "text",
        sizeBytes: 1,
        processingStatus: "ready",
      })),
    );
    const r = await upload(cookie, id, new File(["uno más"], "extra.txt", { type: "text/plain" }));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/máximo/);
  });

  it("keeps a teacher note for audio (the tutor cannot listen), retries failed files and deletes files", async () => {
    const { cookie, id } = await setup();
    const audioId = await uploadReady(cookie, id, new File([new Uint8Array([73, 68, 51, 3, 0, 0])], "explicacion.mp3", { type: "audio/mpeg" }));
    let files = (await call("GET", `/api/activities/${id}/files`, { cookie })).body.files;
    const audio = files.find((f: { id: string }) => f.id === audioId);
    expect(audio.kind).toBe("audio");
    expect(audio.processingStatus).toBe("ready");
    expect(audio.processingError).toMatch(/no puede escuchar audios/);

    const note = await call("PATCH", `/api/activities/${id}/files/${audioId}`, { cookie, body: { teacherNote: "Transcripción: el agua se evapora con el calor del sol." } });
    expect(note.status).toBe(200);
    expect(note.body.file.teacherNote).toBe("Transcripción: el agua se evapora con el calor del sol.");
    expect((await call("PATCH", `/api/activities/${id}/files/${audioId}`, { cookie, body: { teacherNote: "x".repeat(20_001) } })).status).toBe(400);

    const brokenId = await uploadReady(cookie, id, new File(["esto no es un pdf"], "roto.pdf", { type: "application/pdf" }));
    files = (await call("GET", `/api/activities/${id}/files`, { cookie })).body.files;
    const broken = files.find((f: { id: string }) => f.id === brokenId);
    expect(broken.processingStatus).toBe("failed");
    expect(broken.processingError).toMatch(/No pudimos abrir este PDF/);
    const retry = await call("POST", `/api/activities/${id}/files/${brokenId}/retry`, { cookie });
    expect(retry.status).toBe(200);
    await waitForFile({ table: "activity_files", id: brokenId });
    const [row] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.id, brokenId));
    expect(row!.processingStatus).toBe("failed");
    expect((await call("POST", `/api/activities/${id}/files/${audioId}/retry`, { cookie })).status).toBe(400);

    const key = await storageKey(brokenId);
    expect(await fileSize(key)).not.toBeNull();
    const del = await call("DELETE", `/api/activities/${id}/files/${brokenId}`, { cookie });
    expect(del.status).toBe(200);
    expect(await fileSize(key)).toBeNull();
    expect((await call("GET", `/api/activities/${id}/files`, { cookie })).body.files).toHaveLength(1);
  });

  it("duplicates an activity with its configuration and real copies of its files", async () => {
    const { cookie, id, room, token } = await setup();
    await call("PATCH", `/api/activities/${id}`, {
      cookie,
      body: { instructions: "¿Por qué llueve?", requireInitialAnswer: false, reflectionQuestions: [], voiceLanguage: "en" },
    });
    await call("POST", `/api/activities/${id}/publish`, { cookie });
    const fileId = await uploadReady(cookie, id, new File(["El agua se evapora."], "lectura.txt", { type: "text/plain" }));
    const originalKey = await storageKey(fileId);

    const r = await call("POST", `/api/activities/${id}/duplicate`, { cookie, body: {} });
    expect(r.status).toBe(201);
    expect(r.body.copiedFiles).toBe(1);
    expect(r.body.skippedFiles).toBe(0);
    const copy = r.body.activity;
    expect(copy.id).not.toBe(id);
    expect(copy.title).toBe("El ciclo del agua (Copia)");
    expect(copy.status).toBe("draft");
    expect(copy.classroomId).toBe(room);
    expect(copy.linkToken).not.toBe(token);
    expect(copy.instructions).toBe("¿Por qué llueve?");
    expect(copy.requireInitialAnswer).toBe(false);
    expect(copy.reflectionQuestions).toEqual([]);
    expect(copy.voiceLanguage).toBe("en");
    expect(copy.participants).toBe(0);

    const copyFiles = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, copy.id));
    expect(copyFiles).toHaveLength(1);
    expect(copyFiles[0]!.storageKey).not.toBe(originalKey);
    expect(copyFiles[0]!.storageKey.startsWith(`activities/${copy.id}/`)).toBe(true);
    expect(copyFiles[0]!.processingStatus).toBe("ready");
    expect(copyFiles[0]!.extractedText).toBe("El agua se evapora.");
    expect((await readFile(copyFiles[0]!.storageKey)).toString("utf8")).toBe("El agua se evapora.");
    expect(await fileSize(originalKey)).not.toBeNull();

    // To another classroom of the same workspace; long titles still fit.
    const room2 = await newClassroom(cookie, "6.º A");
    await call("PATCH", `/api/activities/${id}`, { cookie, body: { title: "T".repeat(160) } });
    const r2 = await call("POST", `/api/activities/${id}/duplicate`, { cookie, body: { classroomId: room2 } });
    expect(r2.status).toBe(201);
    expect(r2.body.activity.classroomId).toBe(room2);
    expect(r2.body.activity.title.length).toBeLessThanOrEqual(160);
    expect(r2.body.activity.title.endsWith(" (Copia)")).toBe(true);
  });

  it("deletes the activity and its files on disk, only with the typed confirmation", async () => {
    const { cookie, id } = await setup();
    const fileId = await uploadReady(cookie, id, new File(["borrar"], "a.txt", { type: "text/plain" }));
    const key = await storageKey(fileId);
    expect(await fileSize(key)).not.toBeNull();

    expect((await call("DELETE", `/api/activities/${id}`, { cookie, body: { confirm: "borrar ya" } })).status).toBe(400);
    expect((await call("DELETE", `/api/activities/${id}`, { cookie })).status).toBe(400);
    const r = await call("DELETE", `/api/activities/${id}`, { cookie, body: { confirm: "BORRAR" } });
    expect(r.status).toBe(200);
    expect((await call("GET", `/api/activities/${id}`, { cookie })).status).toBe(404);
    expect(await fileSize(key)).toBeNull();
    expect(await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, id))).toHaveLength(0);
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_deleted"));
    expect(logs).toHaveLength(1);
  });
});

describe("UI audit fixes: files that could not be read (D35)", () => {
  it("are not retryable when the file itself is damaged and do not count toward the limit", async () => {
    const { cookie, id } = await setup();
    const bad = new File([new TextEncoder().encode("%PDF-1.4 esto no es un pdf")], "corrupto.pdf", { type: "application/pdf" });
    const badId = await uploadReady(cookie, id, bad);
    const files = (await call("GET", `/api/activities/${id}/files`, { cookie })).body.files;
    expect(files.find((f: { id: string }) => f.id === badId)).toMatchObject({ processingStatus: "failed", retryable: false });

    // With the damaged one in the list, there is still room for MAX_FILES_PER_ACTIVITY usable files.
    const many = Array.from({ length: MAX_FILES_PER_ACTIVITY }, (_, i) => new File([`texto ${i}`], `nota-${i}.txt`, { type: "text/plain" }));
    const r = await upload(cookie, id, ...many);
    expect(r.status).toBe(201);
    expect(r.body.files).toHaveLength(MAX_FILES_PER_ACTIVITY);
    expect(r.body.rejected).toHaveLength(0);
    const extra = await upload(cookie, id, new File(["una más"], "extra.txt", { type: "text/plain" }));
    expect(extra.status).toBe(400);
  });
});

/** A scan: pages with no text layer, so the AI has to read them. */
async function scannedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawRectangle({ x: 40, y: 600, width: 300, height: 120 });
  return doc.save();
}

const BLOCKED = "Output blocked by content filtering policy";

describe("scanned pages of a published book (the API will not copy them word for word)", () => {
  it("falls back to complete notes in the AI's own words, so the tutor can use the material", async () => {
    const { cookie, id } = await setup();
    aiMock.error(400, "invalid_request_error", BLOCKED);
    aiMock.text("[Página 1]\nEsparta era una ciudad-estado del Peloponeso centrada en el ejército; los ilotas trabajaban la tierra.");
    const fileId = await uploadReady(cookie, id, new File([new Uint8Array(await scannedPdf(3))], "Sparta and Athens.pdf", { type: "application/pdf" }));

    const [row] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.id, fileId));
    expect(row!.processingStatus).toBe("ready");
    expect(row!.extractedText).toContain("ilotas");
    expect(row!.processingError).toContain("apuntes completos");
    // The second request asked for notes, not a copy.
    const system = JSON.stringify(aiMock.lastRequest()!.body.system);
    expect(system).toContain("No copies el texto palabra por palabra");
  });

  it("explains what to do when even the notes are blocked", async () => {
    const { cookie, id } = await setup();
    aiMock.error(400, "invalid_request_error", BLOCKED);
    aiMock.error(400, "invalid_request_error", BLOCKED);
    const r = await upload(cookie, id, new File([new Uint8Array(await scannedPdf(1))], "Libro.pdf", { type: "application/pdf" }));
    await waitForFile({ table: "activity_files", id: r.body.files[0].id });
    const [row] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.id, r.body.files[0].id));
    expect(row!.processingStatus).toBe("failed");
    expect(row!.processingError).toContain("libro publicado");
  });
});

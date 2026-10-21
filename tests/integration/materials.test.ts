import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newTeacher, newClassroom } from "./helpers";
import { filesForm, makeDocx, makePdf } from "./materials-fixtures";
import { db, schema } from "@server/db/client";
import { waitForFile } from "@server/services/file-jobs";
import { fileSize } from "@server/lib/storage";
import { MAX_TEXT_FOR_ACTIVITY } from "@shared/domain/library";

const page = (n: number) => `Oracion distintiva de la pagina numero ${n} sobre el ciclo del agua y las nubes.`;

async function upload(cookie: string, files: Parameters<typeof filesForm>[0], extra?: Record<string, string>) {
  return call("POST", "/api/materials/files", { cookie, form: filesForm(files, extra) });
}

async function uploadReady(cookie: string, file: Parameters<typeof filesForm>[0][number]) {
  const r = await upload(cookie, [file]);
  expect(r.status).toBe(201);
  const id = r.body.materials[0].id as string;
  await waitForFile({ table: "materials", id }, 60_000);
  return id;
}

async function newActivity(teacherId: string, classroomId: string, material = "") {
  const [row] = await db
    .insert(schema.activities)
    .values({ classroomId, teacherId, title: "Actividad de prueba", material, linkToken: `t-${Math.random().toString(36).slice(2)}` })
    .returning();
  return row!;
}

describe("library uploads", () => {
  it("reads a 150-page PDF completely (no page limit)", async () => {
    const a = await newTeacher();
    const pdf = await makePdf(150, page);
    const r = await upload(a.cookie, [{ name: "Ciencias naturales - unidad 3.pdf", data: pdf, type: "application/pdf" }], { folder: "Ciencias", tags: "#Agua, nubes" });
    expect(r.status).toBe(201);
    const m = r.body.materials[0];
    expect(m).toMatchObject({ kind: "file", fileKind: "pdf", title: "Ciencias naturales - unidad 3", folder: "Ciencias", tags: ["agua", "nubes"] });
    expect(["pending", "processing"]).toContain(m.processingStatus);

    await waitForFile({ table: "materials", id: m.id }, 60_000);
    const d = await call("GET", `/api/materials/${m.id}`, { cookie: a.cookie });
    expect(d.body.material).toMatchObject({ processingStatus: "ready", pageCount: 150 });
    expect(d.body.material.textChars).toBeGreaterThan(150 * 60);

    const [row] = await db.select().from(schema.materials).where(eq(schema.materials.id, m.id));
    expect(row!.extractedText).toContain("[Página 150]");
    expect(row!.extractedText).toContain(page(150));
    expect(row!.extractedText).toContain(page(1));

    // Paged preview of the extracted text.
    const first = await call("GET", `/api/materials/${m.id}/text?offset=0&limit=2000`, { cookie: a.cookie });
    expect(first.body).toMatchObject({ offset: 0, limit: 2000, pageCount: 150 });
    expect(first.body.text.length).toBe(2000);
    expect(first.body.total).toBe(row!.extractedText.length);
    const last = await call("GET", `/api/materials/${m.id}/text?offset=${first.body.total - 1000}&limit=1000`, { cookie: a.cookie });
    expect(last.body.text).toContain(page(150));

    // Original file download.
    const dl = await call("GET", `/api/materials/${m.id}/download`, { cookie: a.cookie });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-disposition")).toMatch(/attachment/);
    expect(Number(dl.headers.get("content-length"))).toBe(pdf.byteLength);
  });

  it("reads Word (.docx) and plain text files", async () => {
    const a = await newTeacher();
    const docx = makeDocx(["La Revolucion de Mayo ocurrio en 1810.", "El Cabildo abierto se reunio el 22 de mayo."]);
    const docId = await uploadReady(a.cookie, { name: "Revolución de Mayo.docx", data: docx });
    const txtId = await uploadReady(a.cookie, { name: "apunte.txt", data: "Apunte de clase: los planetas giran alrededor del Sol." });
    const [doc] = await db.select().from(schema.materials).where(eq(schema.materials.id, docId));
    expect(doc).toMatchObject({ processingStatus: "ready", fileKind: "docx" });
    expect(doc!.extractedText).toContain("El Cabildo abierto se reunio el 22 de mayo.");
    const [txt] = await db.select().from(schema.materials).where(eq(schema.materials.id, txtId));
    expect(txt).toMatchObject({ processingStatus: "ready", fileKind: "text", extractedText: "Apunte de clase: los planetas giran alrededor del Sol." });
  });

  it("rejects unsupported files with a clear message and keeps the valid ones", async () => {
    const a = await newTeacher();
    const only = await upload(a.cookie, [{ name: "viejo.doc", data: "x" }]);
    expect(only.status).toBe(400);
    expect(only.body.error.message).toMatch(/Word antiguo/);
    const mixed = await upload(a.cookie, [
      { name: "foto.heic", data: "x" },
      { name: "ok.txt", data: "Texto válido" },
    ]);
    expect(mixed.status).toBe(201);
    expect(mixed.body.materials).toHaveLength(1);
    expect(mixed.body.rejected).toEqual([{ fileName: "foto.heic", message: expect.stringMatching(/HEIC/) }]);
  });

  it("marks unreadable files as failed with the reason and lets the teacher retry", async () => {
    const a = await newTeacher();
    const r = await upload(a.cookie, [{ name: "roto.pdf", data: "esto no es un pdf" }]);
    const id = r.body.materials[0].id;
    await waitForFile({ table: "materials", id }, 30_000);
    const d = await call("GET", `/api/materials/${id}`, { cookie: a.cookie });
    expect(d.body.material.processingStatus).toBe("failed");
    expect(d.body.material.processingError).toMatch(/No pudimos abrir este PDF/);
    const retry = await call("POST", `/api/materials/${id}/retry`, { cookie: a.cookie });
    expect(retry.status).toBe(200);
    expect(["pending", "processing", "failed"]).toContain(retry.body.material.processingStatus);
    await waitForFile({ table: "materials", id }, 30_000);
  });
});

describe("texts and links", () => {
  it("creates, filters, edits and deletes written texts and links", async () => {
    const a = await newTeacher();
    const text = await call("POST", "/api/materials", {
      cookie: a.cookie,
      body: { kind: "text", title: "Poema de Storni", body: "Hombre pequeñito, hombre pequeñito…", folder: "Lengua", tags: ["poesía", "#Storni"] },
    });
    expect(text.status).toBe(201);
    expect(text.body.material).toMatchObject({ kind: "text", processingStatus: "ready", tags: ["poesía", "storni"], folder: "Lengua" });

    const badLink = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "link", title: "x", url: "javascript:alert(1)" } });
    expect(badLink.status).toBe(400);
    expect(badLink.body.error.fields.url).toMatch(/https/);
    const link = await call("POST", "/api/materials", {
      cookie: a.cookie,
      body: { kind: "link", title: "Video del ciclo del agua", url: "https://example.org/agua", body: "Muestra la evaporación.", tags: "agua" },
    });
    expect(link.status).toBe(201);

    const all = await call("GET", "/api/materials", { cookie: a.cookie });
    expect(all.body.materials).toHaveLength(2);
    expect(all.body.materials[0].body).toBeUndefined();
    expect(all.body.folders).toEqual([{ name: "Lengua", count: 1 }]);
    expect(all.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(["agua", "poesía", "storni"]);
    expect(all.body).toMatchObject({ total: 2, limit: 500 });

    const byFolder = await call("GET", "/api/materials?folder=Lengua", { cookie: a.cookie });
    expect(byFolder.body.materials.map((x: { id: string }) => x.id)).toEqual([text.body.material.id]);
    const noFolder = await call("GET", "/api/materials?folder=", { cookie: a.cookie });
    expect(noFolder.body.materials.map((x: { id: string }) => x.id)).toEqual([link.body.material.id]);
    const byTag = await call("GET", "/api/materials?tag=agua", { cookie: a.cookie });
    expect(byTag.body.materials).toHaveLength(1);
    const byContent = await call("GET", `/api/materials?q=${encodeURIComponent("pequeñito")}`, { cookie: a.cookie });
    expect(byContent.body.materials.map((x: { id: string }) => x.id)).toEqual([text.body.material.id]);
    const wildcard = await call("GET", "/api/materials?q=%25", { cookie: a.cookie });
    expect(wildcard.body.materials).toHaveLength(0);

    const edit = await call("PATCH", `/api/materials/${text.body.material.id}`, {
      cookie: a.cookie,
      body: { title: "Poema", folder: "", tags: "lengua", body: "Texto nuevo" },
    });
    expect(edit.body.material).toMatchObject({ title: "Poema", folder: "", tags: ["lengua"], body: "Texto nuevo" });
    const emptyBody = await call("PATCH", `/api/materials/${text.body.material.id}`, { cookie: a.cookie, body: { body: "  " } });
    expect(emptyBody.status).toBe(400);

    expect((await call("DELETE", `/api/materials/${link.body.material.id}`, { cookie: a.cookie })).status).toBe(200);
    expect((await call("GET", `/api/materials/${link.body.material.id}`, { cookie: a.cookie })).status).toBe(404);
  });

  it("deletes the stored file together with a file material", async () => {
    const a = await newTeacher();
    const id = await uploadReady(a.cookie, { name: "borrar.txt", data: "contenido" });
    const [row] = await db.select().from(schema.materials).where(eq(schema.materials.id, id));
    expect(await fileSize(row!.storageKey!)).toBeGreaterThan(0);
    await call("DELETE", `/api/materials/${id}`, { cookie: a.cookie });
    expect(await fileSize(row!.storageKey!)).toBeNull();
  });

  it("isolates workspaces", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const t = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "Mío", body: "Secreto" } });
    const id = t.body.material.id;
    for (const [method, path] of [
      ["GET", `/api/materials/${id}`],
      ["GET", `/api/materials/${id}/text`],
      ["PATCH", `/api/materials/${id}`],
      ["DELETE", `/api/materials/${id}`],
    ] as const) {
      const r = await call(method, path, { cookie: b.cookie, body: method === "PATCH" ? { title: "x" } : undefined });
      expect(r.status).toBe(404);
    }
    const list = await call("GET", "/api/materials", { cookie: b.cookie });
    expect(list.body.materials).toHaveLength(0);
  });
});

describe("attach to an activity", () => {
  it("copies files (with their text) and appends texts and links without overwriting", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const activity = await newActivity(a.id, room, "Material que ya estaba.");

    const pdfId = await uploadReady(a.cookie, { name: "guia.pdf", data: await makePdf(3, page) });
    const att = await call("POST", `/api/materials/${pdfId}/attach`, { cookie: a.cookie, body: { activityId: activity.id } });
    expect(att.status).toBe(200);
    expect(att.body).toMatchObject({ attachedAs: "file", activityId: activity.id, processing: false });
    const files = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, activity.id));
    expect(files).toHaveLength(1);
    const [lib] = await db.select().from(schema.materials).where(eq(schema.materials.id, pdfId));
    expect(files[0]).toMatchObject({ kind: "pdf", processingStatus: "ready", pageCount: 3, fileName: "guia.pdf" });
    expect(files[0]!.extractedText).toBe(lib!.extractedText);
    expect(files[0]!.storageKey).not.toBe(lib!.storageKey);
    expect(files[0]!.storageKey.startsWith(`activities/${activity.id}/`)).toBe(true);
    expect(await fileSize(files[0]!.storageKey)).toBe(lib!.sizeBytes);

    const text = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "Consigna extra", body: "Leé el texto dos veces." } });
    const link = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "link", title: "Mapa", url: "https://example.org/mapa" } });
    expect((await call("POST", `/api/materials/${text.body.material.id}/attach`, { cookie: a.cookie, body: { activityId: activity.id } })).body.attachedAs).toBe("text");
    expect((await call("POST", `/api/materials/${link.body.material.id}/attach`, { cookie: a.cookie, body: { activityId: activity.id } })).status).toBe(200);
    const [after] = await db.select().from(schema.activities).where(eq(schema.activities.id, activity.id));
    expect(after!.material).toBe("Material que ya estaba.\n\n— Consigna extra —\nLeé el texto dos veces.\n\n— Mapa —\nEnlace: https://example.org/mapa");

    // A long written text is attached whole as a text file (never cut).
    const longBody = `Inicio. ${"palabra ".repeat(Math.ceil(MAX_TEXT_FOR_ACTIVITY / 8) + 50)}Final del texto largo.`;
    const long = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "Cuento largo", body: longBody } });
    const longAtt = await call("POST", `/api/materials/${long.body.material.id}/attach`, { cookie: a.cookie, body: { activityId: activity.id } });
    expect(longAtt.body.attachedAs).toBe("file");
    const textFile = (await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, activity.id))).find((f) => f.kind === "text");
    expect(textFile!.extractedText).toContain("Final del texto largo.");
    expect(textFile!.fileName).toBe("Cuento largo.txt");
  });

  it("copies a file that is still being read and processes the copy", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const activity = await newActivity(a.id, room);
    const r = await upload(a.cookie, [{ name: "lento.txt", data: "Texto que se lee en segundo plano." }]);
    const id = r.body.materials[0].id;
    // Simulate "still reading" regardless of how fast the background job was.
    await waitForFile({ table: "materials", id }, 10_000);
    await db.update(schema.materials).set({ processingStatus: "pending", extractedText: "" }).where(eq(schema.materials.id, id));
    const att = await call("POST", `/api/materials/${id}/attach`, { cookie: a.cookie, body: { activityId: activity.id } });
    expect(att.body).toMatchObject({ attachedAs: "file", processing: true });
    const [file] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, activity.id));
    await waitForFile({ table: "activity_files", id: file!.id }, 10_000);
    const [done] = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.id, file!.id));
    expect(done).toMatchObject({ processingStatus: "ready", extractedText: "Texto que se lee en segundo plano." });
  });

  it("refuses failed files and activities of another workspace", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const roomB = await newClassroom(b.cookie);
    const actB = await newActivity(b.id, roomB);
    const text = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "T", body: "B" } });
    const r = await call("POST", `/api/materials/${text.body.material.id}/attach`, { cookie: a.cookie, body: { activityId: actB.id } });
    expect(r.status).toBe(404);

    const roomA = await newClassroom(a.cookie);
    const actA = await newActivity(a.id, roomA);
    const bad = await upload(a.cookie, [{ name: "roto.pdf", data: "no pdf" }]);
    await waitForFile({ table: "materials", id: bad.body.materials[0].id }, 30_000);
    const refused = await call("POST", `/api/materials/${bad.body.materials[0].id}/attach`, { cookie: a.cookie, body: { activityId: actA.id } });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/No pudimos leer «roto»/);
  });
});

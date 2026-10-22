// The file a student hands in with the final answer ("entrega") and its rubric analysis.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { makePdf } from "./materials-fixtures";
import { db, schema } from "@server/db/client";
import { randomToken } from "@server/lib/crypto";
import { fileSize } from "@server/lib/storage";
import { waitForFile } from "@server/services/file-jobs";
import { cookieName } from "@server/services/student/session";
import { collectWorkspaceFileKeys } from "@server/services/workspace";
import { storageUsedBytes } from "@server/services/quota";
import { LINK_NOT_PUBLIC, setLinkFetch } from "@server/services/link-reader";
import { LINK_NOT_READ } from "@server/services/deliverables";

type ActivityInsert = typeof schema.activities.$inferInsert;

const RUBRIC = [
  {
    id: "expl",
    name: "Explicación",
    description: "Explica por qué flota un barco.",
    levels: [
      { label: "Inicial", description: "Repite que es liviano." },
      { label: "En proceso", description: "Menciona la forma." },
      { label: "Logrado", description: "Relaciona la forma con el agua desplazada." },
    ],
  },
  {
    id: "ej",
    name: "Ejemplo",
    description: "Usa un ejemplo propio.",
    levels: [
      { label: "Sin ejemplo", description: "" },
      { label: "Con ejemplo", description: "" },
    ],
  },
];

const FILE_LINE = "El barco de acero flota porque su forma hueca desplaza mucha agua";

async function setup(over: Partial<ActivityInsert> = {}) {
  const teacher = await newTeacher();
  const classroomId = await newClassroom(teacher.cookie, "5.º B");
  const token = randomToken(12);
  const [activity] = await db
    .insert(schema.activities)
    .values({
      classroomId,
      teacherId: teacher.id,
      title: "¿Por qué flotan los barcos?",
      instructions: "Explicá por qué flota un barco de acero.",
      status: "published",
      publishedAt: new Date(),
      linkToken: token,
      requireInitialAnswer: false,
      deliverableMode: "optional",
      deliverablePrompt: "Un informe del experimento con el barco de aluminio.",
      ...over,
    })
    .returning();
  const r = await call("POST", `/api/s/${token}/join`, { body: { name: "Ana Gómez" } });
  expect(r.status).toBe(201);
  const cookie = cookiePair(r.cookies, cookieName(activity!.id));
  const [session] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.activityId, activity!.id));
  return { teacher, classroomId, activity: activity!, token, cookie, session: session!, workspace: r.body.workspace };
}

function form(name: string, bytes: Uint8Array | string, type: string) {
  const f = new FormData();
  f.append("file", new Blob([bytes as BlobPart], { type }), name);
  return f;
}

async function uploadPdf(token: string, cookie: string, name = "informe.pdf") {
  const pdf = await makePdf(2, (n) => (n === 1 ? FILE_LINE : "Probamos con un tornillo y se hundió."));
  return call("POST", `/api/s/${token}/deliverable/upload`, { cookie, form: form(name, pdf, "application/pdf") });
}

async function rowOf(sessionId: string) {
  const [row] = await db.select().from(schema.sessionDeliverables).where(eq(schema.sessionDeliverables.sessionId, sessionId));
  return row;
}

const exists = async (key: string | null) => key !== null && (await fileSize(key)) !== null;

describe("deliverable settings", () => {
  it("the teacher turns it on and describes what to hand in", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const { activity } = (await call("POST", "/api/activities", { cookie: t.cookie, body: { classroomId: room, title: "Flotación" } })).body;
    // New activities let students hand in a file or link if they want.
    expect(activity.deliverableMode).toBe("optional");
    const r = await call("PATCH", `/api/activities/${activity.id}`, {
      cookie: t.cookie,
      body: { deliverableMode: "required", deliverablePrompt: "Una foto del barco que armaste." },
    });
    expect(r.status).toBe(200);
    expect(r.body.activity).toMatchObject({ deliverableMode: "required", deliverablePrompt: "Una foto del barco que armaste." });
    const bad = await call("PATCH", `/api/activities/${activity.id}`, { cookie: t.cookie, body: { deliverableMode: "siempre" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.deliverableMode).toBeTruthy();
    const long = await call("PATCH", `/api/activities/${activity.id}`, { cookie: t.cookie, body: { deliverablePrompt: "x".repeat(601) } });
    expect(long.status).toBe(400);
  });
});

describe("student hands in a file", () => {
  it("is not possible when the activity does not ask for one", async () => {
    const s = await setup({ deliverableMode: "off" });
    expect(s.workspace.activity.deliverableMode).toBe("off");
    const r = await uploadPdf(s.token, s.cookie);
    expect(r.status).toBe(400);
  });

  it("uploads, reads it in the background, replaces it and removes it", async () => {
    const s = await setup();
    expect(s.workspace.activity).toMatchObject({ deliverableMode: "optional", deliverablePrompt: "Un informe del experimento con el barco de aluminio." });
    expect(s.workspace.deliverable).toBeNull();

    const up = await uploadPdf(s.token, s.cookie);
    expect(up.status).toBe(201);
    expect(up.body.workspace.deliverable).toMatchObject({ name: "informe.pdf", kind: "pdf" });
    const first = (await rowOf(s.session.id))!;
    await waitForFile({ table: "session_deliverables", id: first.id });
    const read = (await rowOf(s.session.id))!;
    expect(read.processingStatus).toBe("ready");
    expect(read.extractedText).toContain("desplaza mucha agua");
    expect(read.pageCount).toBe(2);

    // The student sees their own file; another device cannot.
    const own = await call("GET", `/api/s/${s.token}/deliverable/file`, { cookie: s.cookie });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    expect((await call("GET", `/api/s/${s.token}/deliverable/file`)).status).toBe(401);

    const again = await call("POST", `/api/s/${s.token}/deliverable/upload`, {
      cookie: s.cookie,
      form: form("notas.txt", "Mis notas: el barco desplaza agua.", "text/plain"),
    });
    expect(again.status).toBe(201);
    expect(again.body.workspace.deliverable).toMatchObject({ name: "notas.txt", kind: "text" });
    const second = (await rowOf(s.session.id))!;
    expect(second.id).toBe(first.id);
    expect(await exists(first.storageKey)).toBe(false);
    expect(await exists(second.storageKey)).toBe(true);

    const removed = await call("DELETE", `/api/s/${s.token}/deliverable`, { cookie: s.cookie });
    expect(removed.status).toBe(200);
    expect(removed.body.workspace.deliverable).toBeNull();
    expect(await rowOf(s.session.id)).toBeUndefined();
    expect(await exists(second.storageKey)).toBe(false);

    const events = await db.select().from(schema.pedagogicalEvents).where(eq(schema.pedagogicalEvents.sessionId, s.session.id));
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["deliverable_uploaded", "deliverable_removed"]));
  });

  it("rejects audio, unknown types and photos over 5 MB", async () => {
    const s = await setup();
    const audio = await call("POST", `/api/s/${s.token}/deliverable/upload`, { cookie: s.cookie, form: form("voz.mp3", "ID3", "audio/mpeg") });
    expect(audio.status).toBe(400);
    const exe = await call("POST", `/api/s/${s.token}/deliverable/upload`, { cookie: s.cookie, form: form("juego.exe", "MZ", "application/octet-stream") });
    expect(exe.status).toBe(400);
    const big = await call("POST", `/api/s/${s.token}/deliverable/upload`, {
      cookie: s.cookie,
      form: form("foto.jpg", new Uint8Array(5 * 1024 * 1024 + 10), "image/jpeg"),
    });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toMatch(/fotos pueden pesar hasta/);
    expect(await rowOf(s.session.id)).toBeUndefined();
  });

  it("a required file blocks sending the work until it is uploaded; afterwards it cannot change", async () => {
    const s = await setup({ deliverableMode: "required" });
    const finish = () =>
      call("POST", `/api/s/${s.token}/finish`, { cookie: s.cookie, body: { finalAnswer: "El barco flota por su forma.", reflection: [] } });
    const blocked = await finish();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("deliverable_required");
    expect((await uploadPdf(s.token, s.cookie)).status).toBe(201);
    const done = await finish();
    expect(done.status).toBe(200);
    expect(done.body.workspace.stage).toBe("completed");
    expect(done.body.workspace.deliverable.name).toBe("informe.pdf");
    const late = await call("POST", `/api/s/${s.token}/deliverable/upload`, { cookie: s.cookie, form: form("otra.txt", "otra", "text/plain") });
    expect(late.status).toBe(409);
    expect((await call("DELETE", `/api/s/${s.token}/deliverable`, { cookie: s.cookie })).status).toBe(409);
  });
});

describe("teacher sees and analyzes the file", () => {
  it("shows it in the work, serves it safely and only to its teacher", async () => {
    const s = await setup();
    await uploadPdf(s.token, s.cookie);
    await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
    const d = await call("GET", `/api/sessions/${s.session.id}`, { cookie: s.teacher.cookie });
    expect(d.body.activity).toMatchObject({ deliverableMode: "optional" });
    expect(d.body.deliverable).toMatchObject({ fileName: "informe.pdf", kind: "pdf", processingStatus: "ready", pageCount: 2, analysis: null });
    expect(d.body.deliverable.textChars).toBeGreaterThan(20);

    const file = await call("GET", d.body.deliverable.url, { cookie: s.teacher.cookie });
    expect(file.status).toBe(200);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-disposition")).toMatch(/^inline/);
    const other = await newTeacher();
    expect((await call("GET", d.body.deliverable.url, { cookie: other.cookie })).status).toBe(404);
    expect((await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: other.cookie })).status).toBe(404);
  });

  it("needs a rubric to analyze it", async () => {
    const s = await setup();
    await uploadPdf(s.token, s.cookie);
    await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
    const r = await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: s.teacher.cookie });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/rúbrica/);
  });

  it("suggests a level per criterion, keeping only quotes that are in the file", async () => {
    const s = await setup({ rubric: RUBRIC });
    await uploadPdf(s.token, s.cookie);
    await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
    aiMock.json({
      criteria: [
        { criterionIndex: 0, sufficientEvidence: true, levelIndex: 2, evidence: "su forma hueca desplaza mucha agua", rationale: "Relaciona forma y agua." },
        { criterionIndex: 1, sufficientEvidence: true, levelIndex: 1, evidence: "probamos con una lancha a motor en el río", rationale: "Usa un ejemplo." },
      ],
      overview: "El informe explica la flotación con el agua desplazada.",
      strengths: "Usa la prueba del tornillo.",
      improvements: "Falta comparar pesos.",
    });
    const r = await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: s.teacher.cookie });
    expect(r.status).toBe(200);
    const a = r.body.deliverable.analysis;
    expect(a.criteria[0]).toMatchObject({ criterionId: "expl", levelIndex: 2, evidence: "su forma hueca desplaza mucha agua", evidenceKind: "quote", evidenceDropped: false });
    expect(a.criteria[1]).toMatchObject({ criterionId: "ej", levelIndex: 1, evidence: "", evidenceDropped: true });
    expect(a.overview).toMatch(/agua desplazada/);
    expect(a.rubric.map((c: { id: string }) => c.id)).toEqual(["expl", "ej"]);
    expect(a.generatedAt).toBeTruthy();

    const sent = JSON.stringify(aiMock.lastRequest()!.body.messages);
    expect(sent).toContain("desplaza mucha agua");
    expect(sent).toContain("Un informe del experimento");
    const [usage] = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.purpose, "deliverable_analysis"));
    expect(usage).toBeTruthy();

    // The analysis is stored with the work.
    const d = await call("GET", `/api/sessions/${s.session.id}`, { cookie: s.teacher.cookie });
    expect(d.body.deliverable.analysis.criteria[0].levelIndex).toBe(2);
  });

  it("sends photos to the AI as images and keeps what it describes as observations", async () => {
    const s = await setup({ rubric: RUBRIC });
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
    const up = await call("POST", `/api/s/${s.token}/deliverable/upload`, { cookie: s.cookie, form: form("barco.png", png, "image/png") });
    expect(up.status).toBe(201);
    await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
    aiMock.json({
      criteria: [
        { criterionIndex: 0, sufficientEvidence: true, levelIndex: 1, evidence: "Dibujo de un barco con flechas de agua hacia los costados", rationale: "Muestra la forma." },
        { criterionIndex: 1, sufficientEvidence: false, levelIndex: 0, evidence: "", rationale: "No hay ejemplo." },
      ],
      overview: "Un dibujo del barco.",
      strengths: "Se ve la forma.",
      improvements: "Agregar una explicación escrita.",
    });
    const r = await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: s.teacher.cookie });
    expect(r.status).toBe(200);
    const [first, second] = r.body.deliverable.analysis.criteria;
    expect(first).toMatchObject({ levelIndex: 1, evidenceKind: "observation", evidence: "Dibujo de un barco con flechas de agua hacia los costados" });
    expect(second).toMatchObject({ levelIndex: null });
    const content = aiMock.lastRequest()!.body.messages as { content: { type: string }[] }[];
    expect(content[0]!.content[0]!.type).toBe("image");
  });

  it("the rubric suggestion for the work also reads the file", async () => {
    const s = await setup({ rubric: RUBRIC });
    await uploadPdf(s.token, s.cookie);
    await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
    aiMock.json({
      criteria: [
        { criterionIndex: 0, sufficientEvidence: true, levelIndex: 2, evidence: "su forma hueca desplaza mucha agua", rationale: "Lo dice en su informe." },
        { criterionIndex: 1, sufficientEvidence: false, levelIndex: 0, evidence: "", rationale: "" },
      ],
    });
    const r = await call("POST", `/api/sessions/${s.session.id}/rubric/suggest`, { cookie: s.teacher.cookie });
    expect(r.status).toBe(200);
    expect(r.body.rubric.suggestion[0]).toMatchObject({ levelIndex: 2, evidence: "su forma hueca desplaza mucha agua", evidenceDropped: false });
    expect(JSON.stringify(aiMock.lastRequest()!.body.messages)).toContain("Archivo entregado");
  });
});

describe("files go away with the work", () => {
  it("deleting the work, resetting the activity or deleting the student removes the file from disk", async () => {
    const a = await setup();
    await uploadPdf(a.token, a.cookie);
    const keyA = (await rowOf(a.session.id))!.storageKey;
    expect(await exists(keyA)).toBe(true);
    const del = await call("DELETE", `/api/sessions/${a.session.id}`, { cookie: a.teacher.cookie, body: { confirm: true } });
    expect(del.status).toBe(200);
    expect(await exists(keyA)).toBe(false);

    const b = await setup();
    await uploadPdf(b.token, b.cookie);
    const keyB = (await rowOf(b.session.id))!.storageKey;
    const reset = await call("POST", `/api/activities/${b.activity.id}/reset`, { cookie: b.teacher.cookie, body: { confirm: "REINICIAR" } });
    expect(reset.status).toBe(200);
    expect(await exists(keyB)).toBe(false);

    const c = await setup();
    await uploadPdf(c.token, c.cookie);
    const keyC = (await rowOf(c.session.id))!.storageKey;
    const st = await call("DELETE", `/api/classrooms/${c.classroomId}/students/${c.session.studentId}`, { cookie: c.teacher.cookie });
    expect(st.status).toBe(200);
    expect(await exists(keyC)).toBe(false);
  });

  it("counts toward the workspace quota and is deleted with the workspace", async () => {
    const s = await setup();
    await uploadPdf(s.token, s.cookie);
    const row = (await rowOf(s.session.id))!;
    expect(await storageUsedBytes(s.teacher.id)).toBe(row.sizeBytes);
    expect(await collectWorkspaceFileKeys(s.teacher.id)).toContain(row.storageKey);
    const gone = await call("DELETE", "/api/auth/workspace", { cookie: s.teacher.cookie, body: { confirm: "BORRAR" } });
    expect(gone.status).toBe(200);
    expect(await exists(row.storageKey)).toBe(false);
  });
});

describe("student hands in a link", () => {
  const DOC = "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing";

  it("keeps any link for the teacher to open (the AI does not open it) and it counts as the delivery", async () => {
    const s = await setup({ deliverableMode: "required", rubric: RUBRIC });
    const bad = await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: "javascript:alert(1)" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.url).toBeTruthy();

    const r = await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: "www.canva.com/design/DAF123/view" } });
    expect(r.status).toBe(201);
    expect(r.body.workspace.deliverable).toMatchObject({ kind: "link", name: "Diseño de Canva", url: "https://www.canva.com/design/DAF123/view" });

    const d = await call("GET", `/api/sessions/${s.session.id}`, { cookie: s.teacher.cookie });
    expect(d.body.deliverable).toMatchObject({ kind: "link", url: "https://www.canva.com/design/DAF123/view", processingStatus: "ready", processingError: LINK_NOT_READ });
    const a = await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: s.teacher.cookie });
    expect(a.status).toBe(400);
    // There is no file to serve.
    expect((await call("GET", `/api/sessions/${s.session.id}/deliverable/file`, { cookie: s.teacher.cookie })).status).toBe(404);

    // A required delivery can be a link.
    const done = await call("POST", `/api/s/${s.token}/finish`, { cookie: s.cookie, body: { finalAnswer: "El barco flota porque desplaza mucha agua con su forma." } });
    expect(done.status).toBe(200);
    const after = await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: DOC } });
    expect(after.status).toBe(409);
  });

  it("reads a public Google document so the AI can analyze it with the rubric", async () => {
    const asked: string[] = [];
    setLinkFetch(async (url) => {
      asked.push(url);
      if (url.includes("/export?format=txt")) return new Response(`Informe\n${FILE_LINE}.`, { headers: { "content-type": "text/plain; charset=utf-8" } });
      return new Response("", { status: 404 });
    });
    try {
      const s = await setup({ rubric: RUBRIC });
      expect((await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: DOC } })).status).toBe(201);
      const row = (await rowOf(s.session.id))!;
      expect(row).toMatchObject({ kind: "link", storageKey: null, fileName: "Documento de Google" });
      await waitForFile({ table: "session_deliverables", id: row.id });
      expect(asked).toEqual(["https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=txt"]);
      const ready = (await rowOf(s.session.id))!;
      expect(ready.processingStatus).toBe("ready");
      expect(ready.extractedText).toContain("desplaza mucha agua");

      aiMock.json({
        criteria: [
          { criterionIndex: 0, sufficientEvidence: true, levelIndex: 2, evidence: "su forma hueca desplaza mucha agua", rationale: "Relaciona forma y agua." },
          { criterionIndex: 1, sufficientEvidence: false, levelIndex: 0, evidence: "", rationale: "No hay ejemplo." },
        ],
        overview: "Explica la flotación.",
        strengths: "Clara.",
        improvements: "Falta un ejemplo.",
      });
      const a = await call("POST", `/api/sessions/${s.session.id}/deliverable/analyze`, { cookie: s.teacher.cookie });
      expect(a.status).toBe(200);
      expect(a.body.deliverable.analysis.criteria[0]).toMatchObject({ levelIndex: 2, evidence: "su forma hueca desplaza mucha agua" });
    } finally {
      setLinkFetch(null);
    }
  });

  it("explains how to share a private Google document", async () => {
    // A private document redirects to the Google sign-in page, which is never followed.
    setLinkFetch(async () => new Response(null, { status: 302, headers: { location: "https://accounts.google.com/ServiceLogin?continue=x" } }));
    try {
      const s = await setup();
      await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: DOC } });
      await waitForFile({ table: "session_deliverables", id: (await rowOf(s.session.id))!.id });
      expect((await rowOf(s.session.id))!).toMatchObject({ processingStatus: "failed", processingError: LINK_NOT_PUBLIC });
    } finally {
      setLinkFetch(null);
    }
  });

  it("replacing a file with a link removes the stored file; the link can be removed too", async () => {
    const s = await setup();
    await uploadPdf(s.token, s.cookie);
    const file = (await rowOf(s.session.id))!;
    expect(await exists(file.storageKey)).toBe(true);
    await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: "https://padlet.com/ana/barcos" } });
    const link = (await rowOf(s.session.id))!;
    expect(link).toMatchObject({ id: file.id, kind: "link", storageKey: null, fileName: "padlet.com" });
    expect(await exists(file.storageKey)).toBe(false);
    expect(await storageUsedBytes(s.teacher.id)).toBe(0);

    const removed = await call("DELETE", `/api/s/${s.token}/deliverable`, { cookie: s.cookie });
    expect(removed.body.workspace.deliverable).toBeNull();
    expect(await rowOf(s.session.id)).toBeUndefined();
  });

  it("is not possible when the activity does not ask for a delivery", async () => {
    const s = await setup({ deliverableMode: "off" });
    const r = await call("POST", `/api/s/${s.token}/deliverable/link`, { cookie: s.cookie, body: { url: DOC } });
    expect(r.status).toBe(400);
  });
});

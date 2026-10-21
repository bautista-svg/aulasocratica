import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newTeacher, newClassroom } from "./helpers";
import { aiMock } from "./ai-mock";
import { filesForm, makePdf } from "./materials-fixtures";
import { db, schema } from "@server/db/client";
import { waitForFile } from "@server/services/file-jobs";

const page = (n: number) => `Oracion distintiva de la pagina numero ${n} sobre el ciclo del agua y las nubes.`;

function aiProposal(over: Record<string, unknown> = {}) {
  return {
    activityType: "Análisis de casos",
    title: "El viaje de una gota",
    instructions: "Leé la página 150 y contá el recorrido de una gota de agua. ¿Qué pasaría si no hubiera nubes?",
    objectives: "Explicar el ciclo del agua.",
    teacherNotes: "Trabaja Analizar.",
    tutorType: "comprension_lectora",
    helpLevel: "moderate",
    tutorGuidance: "Preguntá por la evaporación.",
    reflectionQuestions: ["¿Qué te sorprendió?", "¿Qué cambiarías?"],
    materialRefs: ["Página 150: el ciclo del agua"],
    ...over,
  };
}

async function uploadPdf(cookie: string, pages = 150) {
  const r = await call("POST", "/api/materials/files", {
    cookie,
    form: filesForm([{ name: "Libro de ciencias.pdf", data: await makePdf(pages, page), type: "application/pdf" }]),
  });
  expect(r.status).toBe(201);
  return r.body.materials[0].id as string;
}

const baseInput = {
  subject: "Ciencias Naturales",
  grade: "5.º grado",
  topic: "El ciclo del agua",
  durationMinutes: 80,
  priorKnowledge: "Estados de la materia",
  skills: ["Analizar", "Argumentar"],
  activityTypes: ["Análisis de casos"],
  difficulty: "intermedia",
};

describe("class proposals", () => {
  it("grounds the proposals in the full material and uses every input", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const pdfId = await uploadPdf(a.cookie);
    await waitForFile({ table: "materials", id: pdfId }, 60_000);
    const note = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "Apunte", body: "Las nubes se forman por condensación." } });

    aiMock.json({
      proposals: [
        aiProposal(),
        aiProposal({ title: "Debate de nubes", tutorType: "tutor_inventado", activityType: "Cualquier cosa", helpLevel: "muchísimo", reflectionQuestions: ["¿Una sola?"] }),
        aiProposal({ title: "Tercera", activityType: "Resolución de problemas" }),
        aiProposal({ title: "Cuarta que sobra" }),
      ],
    });
    const r = await call("POST", "/api/planning/proposals", {
      cookie: a.cookie,
      body: { ...baseInput, classroomId: room, materialIds: [pdfId, note.body.material.id], extraText: "Texto pegado por la docente." },
    });
    expect(r.status).toBe(200);
    expect(r.body.proposals).toHaveLength(3);
    const [p1, p2] = r.body.proposals;
    expect(p1).toMatchObject({ tutorType: "comprension_lectora", materialRefs: ["Página 150: el ciclo del agua"] });
    expect(p2.tutorType).toBe("pensamiento_critico");
    expect(p2.helpLevel).toBe("moderate");
    expect(p2.activityType).not.toBe("Cualquier cosa");
    expect(p2.reflectionQuestions.length).toBeGreaterThanOrEqual(2);
    expect(r.body.material).toMatchObject({ mode: "full" });
    expect(r.body.material.materials.map((m: { id: string }) => m.id)).toEqual([pdfId, note.body.material.id]);
    expect(r.body.material.materials[0].pageCount).toBe(150);

    const req = aiMock.lastRequest()!;
    const prompt = JSON.stringify(req.body);
    expect(prompt).toContain(page(150)); // the last page reached the model: no silent cut
    expect(prompt).toContain(page(1));
    expect(prompt).toContain("Las nubes se forman por condensación.");
    expect(prompt).toContain("Texto pegado por la docente.");
    for (const s of ["El ciclo del agua", "5.º grado", "1 h 20 min", "Estados de la materia", "Analizar, Argumentar", "Análisis de casos", "Intermedia"]) {
      expect(prompt).toContain(s);
    }
    expect((req.body.output_config as { effort?: string }).effort).toBe("medium");
  });

  it("sends the most related fragments (with page markers) when the material is very long", async () => {
    const a = await newTeacher();
    const filler = Array.from({ length: 400 }, (_, i) => `Parrafo ${i} sobre geografia general, rios, montañas y mapas de la region pampeana.`.repeat(10)).join("\n\n");
    const key = "Los volcanes expulsan lava, cenizas y gases cuando el magma asciende por la chimenea.";
    const big = `${filler}\n\n${key}\n\n${filler}`;
    const up = await call("POST", "/api/materials/files", { cookie: a.cookie, form: filesForm([{ name: "enciclopedia.txt", data: big }]) });
    const id = up.body.materials[0].id;
    await waitForFile({ table: "materials", id }, 30_000);
    aiMock.json({ proposals: [aiProposal(), aiProposal({ title: "B" }), aiProposal({ title: "C" })] });
    const r = await call("POST", "/api/planning/proposals", {
      cookie: a.cookie,
      body: { ...baseInput, topic: "Volcanes: magma, lava y cenizas", materialIds: [id] },
    });
    expect(r.status).toBe(200);
    expect(r.body.material.mode).toBe("excerpts");
    expect(r.body.material.totalChars).toBeGreaterThan(r.body.material.sentChars);
    const prompt = JSON.stringify(aiMock.lastRequest()!.body);
    expect(prompt).toContain(key);
    expect(prompt).toContain("fragmentos seleccionados");
  });

  it("waits for files still being read and names the ones that failed", async () => {
    const a = await newTeacher();
    const pdfId = await uploadPdf(a.cookie, 20); // not awaited: the request waits for it
    aiMock.json({ proposals: [aiProposal(), aiProposal({ title: "B" }), aiProposal({ title: "C" })] });
    const ok = await call("POST", "/api/planning/proposals", { cookie: a.cookie, body: { ...baseInput, materialIds: [pdfId] } });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(aiMock.lastRequest()!.body)).toContain(page(20));

    const bad = await call("POST", "/api/materials/files", { cookie: a.cookie, form: filesForm([{ name: "Guía rota.pdf", data: "no soy un pdf" }]) });
    const badId = bad.body.materials[0].id;
    const before = aiMock.lastRequest();
    const r = await call("POST", "/api/planning/proposals", { cookie: a.cookie, body: { ...baseInput, materialIds: [pdfId, badId] } });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/No pudimos leer «Guía rota»/);
    expect(aiMock.lastRequest()).toBe(before); // the AI was not called
  });

  it("explains when the AI is unavailable and validates the input", async () => {
    const a = await newTeacher();
    aiMock.error(401, "authentication_error", "invalid x-api-key");
    const r = await call("POST", "/api/planning/proposals", { cookie: a.cookie, body: baseInput });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toMatch(/IA/);

    const v = await call("POST", "/api/planning/proposals", { cookie: a.cookie, body: { ...baseInput, topic: "" } });
    expect(v.status).toBe(400);
    expect(v.body.error.fields.topic).toBeTruthy();

    const b = await newTeacher();
    const other = await call("POST", "/api/materials", { cookie: b.cookie, body: { kind: "text", title: "Ajeno", body: "x" } });
    const foreign = await call("POST", "/api/planning/proposals", { cookie: a.cookie, body: { ...baseInput, materialIds: [other.body.material.id] } });
    expect(foreign.status).toBe(404);
  });
});

describe("create the activity from a proposal", () => {
  it("creates a published activity with the materials attached and the tutor copied", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const pdfId = await uploadPdf(a.cookie, 5);
    await waitForFile({ table: "materials", id: pdfId }, 60_000);
    const text = await call("POST", "/api/materials", { cookie: a.cookie, body: { kind: "text", title: "Glosario", body: "Evaporación: pasaje de líquido a gas." } });
    const tutors = await call("GET", "/api/tutors", { cookie: a.cookie });
    const tutor = tutors.body.tutors.find((t: { presetKey: string }) => t.presetKey === "matematico");
    await call("PATCH", `/api/tutors/${tutor.id}`, { cookie: a.cookie, body: { rules: "Usá ejemplos con lluvia.", helpLevel: "intensive" } });

    const r = await call("POST", "/api/planning/create", {
      cookie: a.cookie,
      body: {
        classroomId: room,
        subject: "Ciencias",
        proposal: { ...aiProposal(), title: "Título editado", reflectionQuestions: ["  ¿Qué aprendiste?  ", "", "¿Qué te costó?"] },
        tutorId: tutor.id,
        materialIds: [pdfId, text.body.material.id],
        extraText: "Traigan un vaso con agua.",
        publish: true,
      },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "published", attached: 3, skipped: [] });

    const [act] = await db.select().from(schema.activities).where(eq(schema.activities.id, r.body.activityId));
    expect(act).toMatchObject({
      classroomId: room,
      teacherId: a.id,
      title: "Título editado",
      subject: "Ciencias",
      status: "published",
      tutorId: tutor.id,
      tutorType: "matematico",
      helpLevel: "intensive",
    });
    expect(act!.publishedAt).not.toBeNull();
    expect(act!.linkToken.length).toBeGreaterThanOrEqual(20);
    expect(act!.tutorRules).toContain("Indicaciones para esta actividad: Preguntá por la evaporación.");
    expect(act!.tutorRules).toContain("Reglas del docente: Usá ejemplos con lluvia.");
    expect(act!.tutorRules).toContain("Notas del docente: Trabaja Analizar.");
    expect((act!.reflectionQuestions as { question: string }[]).map((q) => q.question)).toEqual(["¿Qué aprendiste?", "¿Qué te costó?"]);
    expect(act!.material).toContain("— Texto del docente —\nTraigan un vaso con agua.");
    expect(act!.material).toContain("— Glosario —\nEvaporación: pasaje de líquido a gas.");
    expect(act!.instructions).toBe(aiProposal().instructions);

    const files = await db.select().from(schema.activityFiles).where(eq(schema.activityFiles.activityId, act!.id));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "pdf", processingStatus: "ready", pageCount: 5 });
    expect(files[0]!.extractedText).toContain(page(5));
  });

  it("uses the proposal's tutor when none is chosen, keeps 'no reflection' as none, and saves drafts", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const r = await call("POST", "/api/planning/create", {
      cookie: a.cookie,
      body: { classroomId: room, proposal: { ...aiProposal(), tutorType: "inventado", helpLevel: "autonomous", teacherNotes: "", reflectionQuestions: [] } },
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    const [act] = await db.select().from(schema.activities).where(eq(schema.activities.id, r.body.activityId));
    expect(act).toMatchObject({ status: "draft", publishedAt: null, tutorId: null, tutorType: "pensamiento_critico", helpLevel: "autonomous", reflectionQuestions: [] });
    expect(act!.tutorRules).toBe("Indicaciones para esta actividad: Preguntá por la evaporación.");
  });

  it("refuses archived classrooms and other workspaces' classrooms or tutors", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const room = await newClassroom(a.cookie);
    await call("PATCH", `/api/classrooms/${room}`, { cookie: a.cookie, body: { isArchived: true } });
    const archived = await call("POST", "/api/planning/create", { cookie: a.cookie, body: { classroomId: room, proposal: aiProposal() } });
    expect(archived.status).toBe(409);
    expect(archived.body.error.message).toMatch(/archivada/);

    const foreignRoom = await call("POST", "/api/planning/create", { cookie: b.cookie, body: { classroomId: room, proposal: aiProposal() } });
    expect(foreignRoom.status).toBe(404);

    const roomB = await newClassroom(b.cookie);
    const tutorsA = await call("GET", "/api/tutors", { cookie: a.cookie });
    const foreignTutor = await call("POST", "/api/planning/create", {
      cookie: b.cookie,
      body: { classroomId: roomB, proposal: aiProposal(), tutorId: tutorsA.body.tutors[0].id },
    });
    expect(foreignTutor.status).toBe(404);

    const invalid = await call("POST", "/api/planning/create", { cookie: b.cookie, body: { classroomId: roomB, proposal: { ...aiProposal(), title: "" } } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields["proposal.title"]).toBeTruthy();
  });
});

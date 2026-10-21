import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app, call, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { db, schema } from "@server/db/client";
import { humanCode, randomToken } from "@server/lib/crypto";
import { nameKey } from "@shared/domain/names";
import { REPORT_SECTIONS } from "@shared/domain/reports";
import { extractText } from "unpdf";

// ── Seed helpers (direct inserts: reports read what other modules write) ──

async function seedActivity(teacherId: string, classroomId: string, over: Partial<typeof schema.activities.$inferInsert> = {}) {
  const [a] = await db
    .insert(schema.activities)
    .values({
      teacherId,
      classroomId,
      title: "Criterios de divisibilidad",
      objectives: "Justificar por qué un número es divisible por 3.",
      linkToken: randomToken(),
      status: "published",
      publishedAt: new Date(),
      ...over,
    })
    .returning();
  return a!;
}

async function seedStudent(classroomId: string, fullName: string) {
  const [s] = await db
    .insert(schema.students)
    .values({ classroomId, fullName, nameKey: nameKey(fullName) })
    .returning();
  return s!;
}

async function seedSession(activityId: string, studentId: string, over: Partial<typeof schema.learningSessions.$inferInsert> = {}) {
  const [s] = await db
    .insert(schema.learningSessions)
    .values({ activityId, studentId, resumeCode: humanCode(6), ...over })
    .returning();
  return s!;
}

async function seedEvents(sessionId: string, types: string[]) {
  if (types.length) await db.insert(schema.pedagogicalEvents).values(types.map((eventType) => ({ sessionId, eventType })));
}

const RUBRIC = [
  {
    id: "c1",
    name: "Justificación",
    description: "",
    levels: [
      { label: "En inicio", description: "" },
      { label: "En proceso", description: "" },
      { label: "Logrado", description: "" },
    ],
  },
];

/** One classroom, one published activity, two students with work. */
async function scenario() {
  const t = await newTeacher();
  const room = await newClassroom(t.cookie, "5.º B");
  const act = await seedActivity(t.id, room);
  const ana = await seedStudent(room, "Ana Gómez");
  const beto = await seedStudent(room, "Beto Ruiz");
  await seedStudent(room, "Ceci Paz"); // in the roster, never entered
  const s1 = await seedSession(act.id, ana.id, {
    status: "completed",
    initialAnswer: "Creo que 123 no es divisible por 3.",
    finalAnswer: "Sí es divisible porque 1+2+3 = 6.",
    startedAt: new Date(Date.now() - 30 * 60_000),
    completedAt: new Date(Date.now() - 10 * 60_000),
  });
  const s2 = await seedSession(act.id, beto.id, { initialAnswer: "No sé." });
  await seedEvents(s1.id, ["hint_requested", "hint_requested", "clarification_requested", "message_sent"]);
  await seedEvents(s2.id, ["example_requested"]);
  return { t, room, act, ana, beto, s1, s2 };
}

const table = (report: { data: { tables: { title: string; rows: unknown[][] }[] } }, title: string) =>
  report.data.tables.find((x) => x.title === title)!;

describe("reports: observed data is built on the server", () => {
  it("ignores numbers sent by the browser and reads the database", async () => {
    const { t, room } = await scenario();
    const r = await call("POST", "/api/reports", {
      cookie: t.cookie,
      body: {
        kind: "group",
        scope: { classroomId: room },
        // A forged snapshot: must be ignored entirely.
        data: { headline: [{ label: "Trabajos iniciados", value: 987654 }], tables: [] },
        headline: [{ label: "Alumnos del aula", value: 987654 }],
        narrative: { evidence: "inventado" },
        status: "validated",
      },
    });
    expect(r.status).toBe(201);
    const rep = r.body.report;
    expect(JSON.stringify(rep)).not.toContain("987654");
    expect(rep.status).toBe("draft");
    expect(rep.narrative.evidence).toBe("");
    const head = Object.fromEntries(rep.data.headline.map((h: { label: string; value: unknown }) => [h.label, h.value]));
    expect(head["Alumnos del aula"]).toBe(3);
    expect(head["Participaron"]).toBe(2);
    expect(head["Trabajos iniciados"]).toBe(2);
    expect(head["Finalización"]).toBe("50%");
    expect(head["Ayudas pedidas"]).toBe(4);
    const help = table(rep, "Ayudas pedidas por tipo");
    expect(help.rows[0]).toEqual(["Criterios de divisibilidad", 2, 1, 1, 0, 2]);
    const missing = table(rep, "Alumnos del aula que no ingresaron");
    expect(missing.rows).toEqual([["Criterios de divisibilidad", 1, "Ceci Paz"]]);
    expect(rep.title).toBe("Informe grupal — 5.º B");
    // Stored as built, not as sent.
    const [row] = await db.select().from(schema.reports).where(eq(schema.reports.id, rep.id));
    expect(JSON.stringify(row!.data)).not.toContain("987654");
  });

  it("includes only confirmed rubric levels and validated x-ray items", async () => {
    const { t, ana, s1, act, beto, s2 } = await scenario();
    await db.insert(schema.rubricAssessments).values([
      {
        sessionId: s1.id,
        rubricSnapshot: RUBRIC,
        teacherLevels: { c1: 2 },
        teacherComment: "Revisó su idea inicial.",
        status: "confirmed",
        confirmedAt: new Date(),
      },
      // AI suggestion the teacher never confirmed: must not appear.
      {
        sessionId: s2.id,
        rubricSnapshot: RUBRIC,
        teacherLevels: { c1: 0 },
        aiSuggestion: [{ criterionId: "c1", levelIndex: 0 }],
        status: "suggested",
      },
    ]);
    await db.insert(schema.thinkingAnalyses).values({
      sessionId: s1.id,
      items: [
        {
          id: "a",
          moment: "before",
          category: "hypothesis",
          interpretation: "Partió de una hipótesis concreta.",
          evidence: "123 no es divisible por 3",
          status: "validated",
          edited: false,
        },
        {
          id: "b",
          moment: "after",
          category: "metacognition",
          interpretation: "SUGERENCIA SIN VALIDAR",
          evidence: "divisible porque 1+2+3",
          status: "suggested",
          edited: false,
        },
        {
          id: "c",
          moment: "during",
          category: "reformulation",
          interpretation: "DESCARTADA",
          evidence: "divisible porque 1+2+3",
          status: "discarded",
          edited: false,
        },
      ],
    });
    const ind = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "individual", scope: { studentId: ana.id } } });
    expect(ind.status).toBe(201);
    const rep = ind.body.report;
    expect(table(rep, "Rúbricas confirmadas por el docente").rows).toEqual([[act.title, "Justificación", "Logrado", "Revisó su idea inicial."]]);
    const xray = table(rep, "Radiografía del pensamiento validada por el docente").rows;
    expect(xray).toHaveLength(1);
    expect(xray[0]![3]).toBe("Partió de una hipótesis concreta.");
    expect(JSON.stringify(rep)).not.toContain("SUGERENCIA SIN VALIDAR");
    expect(JSON.stringify(rep)).not.toContain("DESCARTADA");
    expect(table(rep, "Respuesta inicial y respuesta final").rows[0]).toEqual([
      act.title,
      "Creo que 123 no es divisible por 3.",
      "Sí es divisible porque 1+2+3 = 6.",
    ]);
    expect(rep.scopeLabel).toBe("5.º B · Ana Gómez");

    // The other student only has an unconfirmed suggestion: no rubric rows at all.
    const other = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "individual", scope: { studentId: beto.id } } });
    expect(table(other.body.report, "Rúbricas confirmadas por el docente").rows).toEqual([]);

    // Group report: level distribution only from the confirmed assessment.
    const grp = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { activityId: act.id } } });
    expect(table(grp.body.report, "Rúbricas confirmadas por el docente").rows).toEqual([[act.title, "Justificación", "Logrado: 1"]]);
    expect(table(grp.body.report, "Radiografía del pensamiento validada por el docente").rows).toEqual([
      ["Antes de la IA", "Hipótesis inicial", 1, 1],
    ]);
  });

  it("builds the overview of active classrooms and refuses it without classrooms", async () => {
    const empty = await newTeacher();
    const none = await call("POST", "/api/reports", { cookie: empty.cookie, body: { kind: "overview" } });
    expect(none.status).toBe(400);

    const { t } = await scenario();
    const archived = await newClassroom(t.cookie, "Aula vieja");
    await call("PATCH", `/api/classrooms/${archived}`, { cookie: t.cookie, body: { isArchived: true } });
    const r = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "overview" } });
    expect(r.status).toBe(201);
    const part = table(r.body.report, "Participación por aula");
    expect(part.rows).toEqual([["5.º B", 3, 1, 2, 1, "50%"]]);
    expect(table(r.body.report, "Ayudas pedidas por tipo").rows).toEqual([["5.º B", 2, 1, 1, 0]]);
  });

  it("refuses an individual report for a student without work", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const st = await seedStudent(room, "Dani Sol");
    const r = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "individual", scope: { studentId: st.id } } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("Dani Sol");
  });

  it("validates the scope with per-field messages", async () => {
    const t = await newTeacher();
    const r = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: {} } });
    expect(r.status).toBe(400);
    expect(r.body.error.fields["scope.classroomId"]).toBe("Elegí un aula.");
  });
});

describe("reports: isolation", () => {
  it("another workspace gets 404 for every report route and cannot use foreign ids", async () => {
    const { t, room, ana } = await scenario();
    const other = await newTeacher();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    for (const [method, path, body] of [
      ["GET", `/api/reports/${rep.id}`],
      ["PATCH", `/api/reports/${rep.id}`, { title: "x" }],
      ["POST", `/api/reports/${rep.id}/refresh`],
      ["POST", `/api/reports/${rep.id}/ai`],
      ["POST", `/api/reports/${rep.id}/validate`],
      ["GET", `/api/reports/${rep.id}/export.csv`],
      ["GET", `/api/reports/${rep.id}/export.pdf`],
      ["DELETE", `/api/reports/${rep.id}`],
    ] as [string, string, unknown?][]) {
      const r = await call(method, path, { cookie: other.cookie, body });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    expect((await call("GET", "/api/reports", { cookie: other.cookie })).body.reports).toEqual([]);
    expect((await call("POST", "/api/reports", { cookie: other.cookie, body: { kind: "group", scope: { classroomId: room } } })).status).toBe(404);
    expect((await call("POST", "/api/reports", { cookie: other.cookie, body: { kind: "individual", scope: { studentId: ana.id } } })).status).toBe(
      404,
    );
    expect((await call("GET", "/api/reports")).status).toBe(401);
  });
});

describe("reports: narrative, validation and refresh", () => {
  it("requires every section before validating; editing afterwards returns it to draft", async () => {
    const { t, room } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    const v1 = await call("POST", `/api/reports/${rep.id}/validate`, { cookie: t.cookie });
    expect(v1.status).toBe(400);
    expect(Object.keys(v1.body.error.fields).sort()).toEqual(REPORT_SECTIONS.group.map((s) => s.key).sort());

    await call("PATCH", `/api/reports/${rep.id}`, {
      cookie: t.cookie,
      body: { narrative: { shared_difficulties: "Pidieron pistas.", evidence: "   " } },
    });
    const v2 = await call("POST", `/api/reports/${rep.id}/validate`, { cookie: t.cookie });
    expect(v2.status).toBe(400);
    expect(Object.keys(v2.body.error.fields).sort()).toEqual(["evidence", "recommendations"]);

    const full = await call("PATCH", `/api/reports/${rep.id}`, {
      cookie: t.cookie,
      body: { narrative: { evidence: "La mitad terminó.", recommendations: "Retomar la regla del 3.", unknown_key: "x" } },
    });
    expect(full.body.report.narrative).toEqual({
      shared_difficulties: "Pidieron pistas.",
      evidence: "La mitad terminó.",
      recommendations: "Retomar la regla del 3.",
    });
    const ok = await call("POST", `/api/reports/${rep.id}/validate`, { cookie: t.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.report.status).toBe("validated");
    expect(ok.body.report.validatedAt).toBeTruthy();

    // Saving the same text keeps the validation; a real change returns it to draft.
    const same = await call("PATCH", `/api/reports/${rep.id}`, { cookie: t.cookie, body: { narrative: { evidence: "La mitad terminó." } } });
    expect(same.body.report.status).toBe("validated");
    const edited = await call("PATCH", `/api/reports/${rep.id}`, {
      cookie: t.cookie,
      body: { narrative: { evidence: "Terminó la mitad del grupo." } },
    });
    expect(edited.body.report.status).toBe("draft");
    expect(edited.body.report.validatedAt).toBeNull();
  });

  it("refreshes the observed data and keeps the teacher's text", async () => {
    const { t, room, act } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    await call("PATCH", `/api/reports/${rep.id}`, {
      cookie: t.cookie,
      body: { narrative: { shared_difficulties: "a", evidence: "b", recommendations: "c" }, title: "Mi informe" },
    });
    await call("POST", `/api/reports/${rep.id}/validate`, { cookie: t.cookie });
    const dani = await seedStudent(room, "Dani Sol");
    await seedSession(act.id, dani.id, { status: "completed", completedAt: new Date() });
    const r = await call("POST", `/api/reports/${rep.id}/refresh`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    const head = Object.fromEntries(r.body.report.data.headline.map((h: { label: string; value: unknown }) => [h.label, h.value]));
    expect(head["Trabajos iniciados"]).toBe(3);
    expect(r.body.report.narrative.evidence).toBe("b");
    expect(r.body.report.title).toBe("Mi informe");
    expect(r.body.report.status).toBe("draft");

    // Scope deleted: the report goes with it (students' data must not survive a deletion —
    // see services/reports/reconcile.ts and /privacidad).
    await call("DELETE", `/api/classrooms/${room}`, { cookie: t.cookie });
    expect((await call("GET", `/api/reports/${rep.id}`, { cookie: t.cookie })).status).toBe(404);
  });

  it("drafts the narrative with AI from the stored snapshot only, without saving it", async () => {
    const { t, room } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    aiMock.json({
      sections: [
        { key: "shared_difficulties", text: "Dos alumnos pidieron ayuda." },
        { key: "evidence", text: "La mitad terminó la actividad." },
        { key: "recommendations", text: "Retomar con un ejemplo en el pizarrón." },
        { key: "otra", text: "ignorar" },
      ],
    });
    const r = await call("POST", `/api/reports/${rep.id}/ai`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.draft).toEqual({
      shared_difficulties: "Dos alumnos pidieron ayuda.",
      evidence: "La mitad terminó la actividad.",
      recommendations: "Retomar con un ejemplo en el pizarrón.",
    });
    const sent = JSON.stringify(aiMock.lastRequest()!.body);
    expect(sent).toContain("<datos_observados>");
    expect(sent).toContain("Trabajos iniciados: 2");
    // Not saved: the teacher inserts what they want.
    expect((await call("GET", `/api/reports/${rep.id}`, { cookie: t.cookie })).body.report.narrative.evidence).toBe("");
    const usage = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.teacherId, t.id));
    expect(usage.map((u) => u.purpose)).toEqual(["report_narrative"]);

    aiMock.error(401, "authentication_error");
    const down = await call("POST", `/api/reports/${rep.id}/ai`, { cookie: t.cookie });
    expect(down.status).toBe(503);
    expect(down.body.error.message).toMatch(/IA/);
  });
});

describe("reports: export", () => {
  it("exports CSV with ';' separators and a UTF-8 BOM", async () => {
    const { t, room } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    await call("PATCH", `/api/reports/${rep.id}`, { cookie: t.cookie, body: { narrative: { evidence: '=SUMA(A1); "cita"' } } });
    const res = await app.request(`/api/reports/${rep.id}/export.csv`, { headers: { cookie: t.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(".csv");
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString("utf8").slice(1);
    const lines = text.split("\r\n");
    expect(lines).toContain("Actividad;Participantes;Finalizaron;% finalización;Tiempo mediano");
    expect(lines).toContain("Alumnos del aula;3");
    expect(lines).toContain('Evidencias de aprendizaje;"\'=SUMA(A1); ""cita"""');
    expect(text).not.toMatch(/^Actividad,Participantes/m);
  });

  it("exports a real PDF", async () => {
    const { t, ana } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "individual", scope: { studentId: ana.id } } })).body.report;
    const res = await app.request(`/api/reports/${rep.id}/export.pdf`, { headers: { cookie: t.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
    // Real text, and no footer-only pages (the footer must not spill onto extra blank pages).
    const { text, totalPages } = await extractText(new Uint8Array(buf), { mergePages: false });
    expect(totalPages).toBe(text.length);
    expect(text.join("\n")).toContain("Ana Gómez");
    expect(text.join("\n")).toContain("Respuesta inicial y respuesta final");
    for (const page of text) expect(page.replace(/[^\n]*Página \d+ de \d+\s*$/, "").trim().length).toBeGreaterThan(40);
    expect(text.at(-1)).toContain(`Página ${totalPages} de ${totalPages}`);
  });

  it("deletes a report", async () => {
    const { t, room } = await scenario();
    const rep = (await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { classroomId: room } } })).body.report;
    expect((await call("GET", "/api/reports", { cookie: t.cookie })).body.reports).toHaveLength(1);
    expect((await call("DELETE", `/api/reports/${rep.id}`, { cookie: t.cookie })).status).toBe(200);
    expect((await call("GET", `/api/reports/${rep.id}`, { cookie: t.cookie })).status).toBe(404);
  });
});

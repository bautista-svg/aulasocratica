import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@server/db/client";
import { call, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { insertActivity, insertFullWork, insertSession, insertStudent } from "./live-fixtures";

async function setup(over: Parameters<typeof insertActivity>[2] = {}) {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie, "4.º A");
  const activity = await insertActivity(t.id, classroomId, over);
  const student = await insertStudent(classroomId, "Ana Gómez");
  return { t, classroomId, activity, student };
}

const AI_ITEMS = {
  items: [
    { aspect: "argumentacion", kind: "strength", observation: "Explica por qué la planta se pondría amarilla.", evidence: "Se pondría amarilla porque no puede hacer la fotosíntesis" },
    { aspect: "creatividad", kind: "strength", observation: "Compara la clorofila con un panel solar.", evidence: "la clorofila es un espejo mágico" },
    { aspect: "argumentacion", kind: "reinforce", observation: "Repetido: se descarta.", evidence: "" },
    { aspect: "ejemplos", kind: "reinforce", observation: "No usa datos concretos para apoyar su idea.", evidence: "" },
  ],
};

describe("strengths and areas to reinforce of a work", () => {
  it("asks the AI with the course and the student's work, keeps real quotes only and one item per aspect", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json(AI_ITEMS);
    const r = await call("POST", `/api/sessions/${session.id}/aspects/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.droppedQuotes).toBe(1);
    expect(r.body.aiGeneratedAt).toBeTruthy();
    expect(r.body.items.map((i: { aspect: string; kind: string }) => `${i.aspect}:${i.kind}`)).toEqual([
      "argumentacion:strength",
      "creatividad:strength",
      "ejemplos:reinforce",
    ]);
    expect(r.body.items[0].evidence).toContain("Se pondría amarilla");
    expect(r.body.items[1].evidence).toBe("");

    const prompt = JSON.stringify(aiMock.lastRequest()!.body.messages);
    expect(prompt).toContain("Curso: ");
    expect(prompt).toContain("Pidió 1 pistas");
    expect(prompt).toContain("La actividad no tiene material cargado.");
    // Without material, "Uso de los materiales" is not offered.
    expect(prompt).not.toContain("materiales: Uso de los materiales");
    const [usage] = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.purpose, "aspect_analysis"));
    expect(usage).toBeTruthy();

    const detail = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(detail.body.aspects.items).toHaveLength(3);
  });

  it("understands aspects written as labels and drops unknown ones instead of failing", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      items: [
        { aspect: "Pensamiento crítico", kind: "strength", observation: "Compara dos ideas.", evidence: "" },
        { aspect: "magia", kind: "strength", observation: "No existe.", evidence: "" },
        { aspect: "redaccion", kind: "bueno", observation: "Tipo inválido.", evidence: "" },
        { aspect: "Vocabulario-del-tema", kind: " REINFORCE ", observation: "Usa poco los términos del tema.", evidence: "" },
        // The activity has no material: nothing to say about using it.
        { aspect: "materiales", kind: "reinforce", observation: "No usa el material.", evidence: "" },
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/aspects/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { aspect: string; kind: string }) => `${i.aspect}:${i.kind}`)).toEqual(["pensamiento_critico:strength", "vocabulario:reinforce"]);
  });

  it("offers the materials aspect when the activity has material", async () => {
    const { t, activity, student } = await setup({ material: "Las hojas tienen clorofila, un pigmento verde que absorbe la luz." });
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({ items: [{ aspect: "materiales", kind: "reinforce", observation: "No usa los datos del texto.", evidence: "" }] });
    const r = await call("POST", `/api/sessions/${session.id}/aspects/analyze`, { cookie: t.cookie });
    expect(r.body.items[0]).toMatchObject({ aspect: "materiales", kind: "reinforce", source: "ai" });
    const prompt = JSON.stringify(aiMock.lastRequest()!.body.messages);
    expect(prompt).toContain("materiales: Uso de los materiales");
    expect(prompt).toContain("un pigmento verde que absorbe la luz");
  });

  it("lets the teacher remove items and mark aspects by hand, and keeps those across new analyses", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const url = `/api/sessions/${session.id}/aspects`;
    aiMock.json(AI_ITEMS);
    const first = await call("POST", `${url}/analyze`, { cookie: t.cookie });

    const removed = await call("DELETE", `${url}/${first.body.items[2].id}`, { cookie: t.cookie });
    expect(removed.body.items.map((i: { aspect: string }) => i.aspect)).toEqual(["argumentacion", "creatividad"]);
    expect((await call("DELETE", `${url}/${first.body.items[2].id}`, { cookie: t.cookie })).status).toBe(404);

    // Marking an aspect replaces what the AI said about it.
    const added = await call("POST", url, { cookie: t.cookie, body: { aspect: "argumentacion", kind: "reinforce", note: "Le falta justificar más." } });
    expect(added.status).toBe(200);
    expect(added.body.items.find((i: { aspect: string }) => i.aspect === "argumentacion")).toMatchObject({
      kind: "reinforce",
      observation: "Le falta justificar más.",
      source: "teacher",
    });
    expect(added.body.items).toHaveLength(2);

    aiMock.json(AI_ITEMS);
    const again = await call("POST", `${url}/analyze`, { cookie: t.cookie });
    const arg = again.body.items.filter((i: { aspect: string }) => i.aspect === "argumentacion");
    expect(arg).toHaveLength(1);
    expect(arg[0]).toMatchObject({ source: "teacher", kind: "reinforce" });

    expect((await call("POST", url, { cookie: t.cookie, body: { aspect: "magia", kind: "strength" } })).status).toBe(400);
    expect((await call("POST", url, { cookie: t.cookie, body: { aspect: "redaccion", kind: "strength", note: "x".repeat(301) } })).status).toBe(400);
    const other = await newTeacher();
    expect((await call("POST", `${url}/analyze`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("POST", url, { cookie: other.cookie, body: { aspect: "redaccion", kind: "strength" } })).status).toBe(404);
  });
});

describe("strengths and areas to reinforce of a group and of a student", () => {
  it("counts the analyzed works of an activity and lists the finished ones still to analyze", async () => {
    const { t, classroomId, activity, student } = await setup();
    const ana = await insertFullWork(activity.id, student.id);
    const beto = await insertFullWork(activity.id, (await insertStudent(classroomId, "Beto Ruiz")).id);
    await insertSession(activity.id, (await insertStudent(classroomId, "Caro Díaz")).id, { initialAnswer: "Todavía pienso." });

    aiMock.json(AI_ITEMS);
    await call("POST", `/api/sessions/${ana.id}/aspects/analyze`, { cookie: t.cookie });
    await call("POST", `/api/sessions/${beto.id}/aspects`, { cookie: t.cookie, body: { aspect: "argumentacion", kind: "strength", note: "" } });

    const r = await call("GET", `/api/activities/${activity.id}/aspects`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ totalWorks: 3, completedWorks: 2, analyzedWorks: 2, pending: [] });
    expect(r.body.aspects[0]).toMatchObject({ aspect: "argumentacion" });
    expect(r.body.aspects[0].strengths.map((m: { who: string }) => m.who)).toEqual(["Ana Gómez", "Beto Ruiz"]);
    expect(r.body.aspects.find((a: { aspect: string }) => a.aspect === "ejemplos").reinforce).toHaveLength(1);

    // A finished work without analysis is listed as pending.
    await db.delete(schema.aspectAnalyses).where(eq(schema.aspectAnalyses.sessionId, beto.id));
    const pending = await call("GET", `/api/activities/${activity.id}/aspects`, { cookie: t.cookie });
    expect(pending.body.pending).toEqual([{ sessionId: beto.id, studentName: "Beto Ruiz" }]);

    const other = await newTeacher();
    expect((await call("GET", `/api/activities/${activity.id}/aspects`, { cookie: other.cookie })).status).toBe(404);
  });

  it("shows a student's aspects across activities on the student page", async () => {
    const { t, classroomId, activity, student } = await setup();
    const second = await insertActivity(t.id, classroomId, { title: "El ciclo del agua" });
    const w1 = await insertFullWork(activity.id, student.id);
    const w2 = await insertFullWork(second.id, student.id);
    aiMock.json(AI_ITEMS);
    await call("POST", `/api/sessions/${w1.id}/aspects/analyze`, { cookie: t.cookie });
    await call("POST", `/api/sessions/${w2.id}/aspects`, { cookie: t.cookie, body: { aspect: "argumentacion", kind: "strength", note: "Muy claro." } });

    const r = await call("GET", `/api/students/${student.id}`, { cookie: t.cookie });
    expect(r.body.aspects.analyzedWorks).toBe(2);
    const arg = r.body.aspects.aspects.find((a: { aspect: string }) => a.aspect === "argumentacion");
    expect(arg.strengths.map((m: { who: string }) => m.who).sort()).toEqual(["El ciclo del agua", "La fotosíntesis"]);
  });
});

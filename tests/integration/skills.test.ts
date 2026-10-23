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

const entry = (skill: string, status: string, evidence = "", extra: Record<string, string> = {}) => ({
  skill,
  status,
  criterion: status === "sin_evidencia" ? "" : "Justifica sus respuestas.",
  evidence,
  why: "Da una razón propia.",
  improve: "Sumar un dato del texto.",
  suggestion: "Pedile un ejemplo.",
  ...extra,
});

const AI = {
  skills: [
    entry("argumentacion", "logrado", "Se pondría amarilla porque no puede hacer la fotosíntesis"),
    entry("creatividad", "Avanzado", "la clorofila atrapa la luz como un panel solar"),
    // A quote of the tutor is not evidence of the student: no level.
    entry("comprension", "logrado", "Pensá en qué parte de la hoja ocurre"),
    entry("pensamiento_critico", "sin_evidencia"),
    entry("dialogo", "regular", "Se pondría amarilla porque no puede hacer la fotosíntesis"),
    // Not asked (the activity has no material): ignored.
    entry("materiales", "inicial", "Se pondría amarilla porque no puede hacer la fotosíntesis"),
  ],
  recommendations: ["Pedile que justifique con datos del texto.", "Valorá su analogía en clase."],
};

const statusOf = (skills: { skill: string; status: string }[], key: string) => skills.find((s) => s.skill === key)?.status;

describe("skills of one work", () => {
  it("evaluates each chosen skill with its indicators and keeps only levels backed by the student's own words", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json(AI);
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.droppedQuotes).toBe(1);
    expect(r.body.skillsAt).toBeTruthy();
    expect(r.body.interventions).toBe(3);
    const s = r.body.skills;
    expect(statusOf(s, "argumentacion")).toBe("logrado");
    expect(statusOf(s, "creatividad")).toBe("avanzado");
    expect(statusOf(s, "comprension")).toBe("sin_evidencia");
    expect(s.find((x: { skill: string }) => x.skill === "comprension").evidence).toBe("");
    expect(statusOf(s, "dialogo")).toBe("sin_evidencia");
    // Skills the AI left out have no valid evaluation either.
    expect(statusOf(s, "redaccion")).toBe("sin_evidencia");
    // Without material, "Uso de los materiales" is not evaluated.
    expect(statusOf(s, "materiales")).toBeUndefined();
    expect(s.find((x: { skill: string }) => x.skill === "argumentacion")).toMatchObject({
      label: "Argumentación",
      dimension: "cognitiva",
      criterion: "Justifica sus respuestas.",
      why: "Da una razón propia.",
      source: "ai",
    });
    expect(r.body.recommendations).toEqual(AI.recommendations);

    const prompt = JSON.stringify(aiMock.lastRequest()!.body);
    expect(prompt).toContain("skill: argumentacion");
    expect(prompt).toContain("Utiliza evidencias para sostener sus ideas.");
    expect(prompt).toContain("Sin evidencia suficiente");
    expect(prompt).not.toContain("skill: materiales");
    expect(prompt).not.toContain("skill: vocabulario");

    const detail = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(detail.body.skills.skills).toHaveLength(8);
    expect(detail.body.skills.catalog.map((c: { key: string }) => c.key)).toContain("redaccion");
  });

  it("evaluates «Uso de los materiales» when the activity has material", async () => {
    const { t, activity, student } = await setup({ material: "Las hojas tienen clorofila, un pigmento verde que absorbe la luz." });
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json(AI);
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(statusOf(r.body.skills, "materiales")).toBe("inicial");
    expect(JSON.stringify(aiMock.lastRequest()!.body)).toContain("un pigmento verde que absorbe la luz");
  });

  it("keeps the level the teacher corrected across new evaluations", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const url = `/api/sessions/${session.id}/skills`;
    aiMock.json(AI);
    await call("POST", `${url}/analyze`, { cookie: t.cookie });

    const fixed = await call("PATCH", `${url}/comprension`, { cookie: t.cookie, body: { status: "logrado" } });
    expect(fixed.status).toBe(200);
    expect(fixed.body.skills.find((s: { skill: string }) => s.skill === "comprension")).toMatchObject({ status: "logrado", source: "teacher" });

    aiMock.json({ ...AI, skills: AI.skills.map((e) => (e.skill === "comprension" ? entry("comprension", "inicial", "Se pondría amarilla porque no puede hacer la fotosíntesis") : e)) });
    const again = await call("POST", `${url}/analyze`, { cookie: t.cookie });
    expect(again.body.skills.find((s: { skill: string }) => s.skill === "comprension")).toMatchObject({ status: "logrado", source: "teacher" });

    expect((await call("PATCH", `${url}/magia`, { cookie: t.cookie, body: { status: "logrado" } })).status).toBe(400);
    expect((await call("PATCH", `${url}/comprension`, { cookie: t.cookie, body: { status: "excelente" } })).status).toBe(400);
    const other = await newTeacher();
    expect((await call("POST", `${url}/analyze`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("PATCH", `${url}/comprension`, { cookie: other.cookie, body: { status: "logrado" } })).status).toBe(404);
  });
});

describe("the workspace's choice of skills", () => {
  it("starts with the default skills, and the teacher can turn them on and off and add her own", async () => {
    const { t, activity, student } = await setup();
    const first = await call("GET", "/api/skills", { cookie: t.cookie });
    expect(first.body.settings.enabled).toEqual(
      expect.arrayContaining(["argumentacion", "creatividad", "comprension", "pensamiento_critico", "reflexion", "revision", "dialogo", "materiales", "redaccion"]),
    );
    expect(first.body.settings.enabled).not.toContain("vocabulario");
    expect(first.body.catalog).toHaveLength(12);

    const own = { id: "c_fuentes1", label: "Trabajo con fuentes", dimension: "proceso", criteria: ["Distingue fuentes primarias y secundarias.", "Indica de dónde saca cada dato."] };
    const saved = await call("PUT", "/api/skills", { cookie: t.cookie, body: { enabled: ["argumentacion", "c_fuentes1", "inventada"], custom: [own] } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.enabled).toEqual(["argumentacion", "c_fuentes1"]);
    expect(saved.body.catalog.find((c: { key: string }) => c.key === "c_fuentes1")).toMatchObject({ custom: true, dimension: "proceso" });

    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({ skills: [entry("c_fuentes1", "en_desarrollo", "la clorofila atrapa la luz como un panel solar")], recommendations: [] });
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(r.body.skills.map((s: { skill: string; status: string }) => `${s.skill}:${s.status}`)).toEqual(["argumentacion:sin_evidencia", "c_fuentes1:en_desarrollo"]);
    const prompt = JSON.stringify(aiMock.lastRequest()!.body);
    expect(prompt).toContain("skill: c_fuentes1 · Trabajo con fuentes");
    expect(prompt).toContain("Distingue fuentes primarias y secundarias.");
    expect(prompt).not.toContain("skill: creatividad");

    expect((await call("PUT", "/api/skills", { cookie: t.cookie, body: { enabled: [], custom: [{ ...own, dimension: "magia" }] } })).status).toBe(400);
    expect((await call("PUT", "/api/skills", { cookie: t.cookie, body: { enabled: [], custom: [{ ...own, criteria: [] }] } })).status).toBe(400);
    // With nothing chosen there is nothing to evaluate.
    await call("PUT", "/api/skills", { cookie: t.cookie, body: { enabled: [], custom: [] } });
    expect((await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie })).status).toBe(400);
    expect((await call("GET", "/api/skills")).status).toBe(401);
  });
});

describe("skills of a group and of a student", () => {
  it("counts each skill by level across the evaluated works and lists the finished ones still to evaluate", async () => {
    const { t, classroomId, activity, student } = await setup();
    const ana = await insertFullWork(activity.id, student.id);
    const beto = await insertFullWork(activity.id, (await insertStudent(classroomId, "Beto Ruiz")).id);
    const caro = await insertFullWork(activity.id, (await insertStudent(classroomId, "Caro Díaz")).id);
    await insertSession(activity.id, (await insertStudent(classroomId, "Dani Paz")).id, { initialAnswer: "Todavía pienso." });

    aiMock.json(AI);
    await call("POST", `/api/sessions/${ana.id}/skills/analyze`, { cookie: t.cookie });
    aiMock.json({ ...AI, skills: [entry("argumentacion", "inicial", "Se pondría amarilla porque no puede hacer la fotosíntesis")] });
    await call("POST", `/api/sessions/${beto.id}/skills/analyze`, { cookie: t.cookie });

    const r = await call("GET", `/api/activities/${activity.id}/skills`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ totalWorks: 4, completedWorks: 3, assessedWorks: 2, interventions: 6 });
    expect(r.body.pending).toEqual([{ sessionId: caro.id, studentName: "Caro Díaz" }]);
    const arg = r.body.skills.find((s: { key: string }) => s.key === "argumentacion");
    expect(arg.counts).toMatchObject({ logrado: 1, inicial: 1, avanzado: 0, sin_evidencia: 0, no_evaluado: 0 });
    expect(arg.criteria).toContain("Justifica sus respuestas.");
    expect(arg.students.map((s: { studentName: string; status: string; evidence: string }) => `${s.studentName}:${s.status}`)).toEqual(["Ana Gómez:logrado", "Beto Ruiz:inicial"]);
    expect(arg.students[0].evidence).toContain("Se pondría amarilla");
    const crea = r.body.skills.find((s: { key: string }) => s.key === "creatividad");
    expect(crea.counts).toMatchObject({ avanzado: 1, sin_evidencia: 1 });

    const other = await newTeacher();
    expect((await call("GET", `/api/activities/${activity.id}/skills`, { cookie: other.cookie })).status).toBe(404);
  });

  it("shows a student's skills across activities, oldest first, with the latest recommendations", async () => {
    const { t, classroomId, activity, student } = await setup();
    const second = await insertActivity(t.id, classroomId, { title: "El ciclo del agua" });
    const w1 = await insertFullWork(activity.id, student.id, { startedAt: new Date(Date.now() - 3 * 86_400_000) });
    const w2 = await insertFullWork(second.id, student.id);
    aiMock.json({ ...AI, skills: [entry("argumentacion", "en_desarrollo", "Se pondría amarilla porque no puede hacer la fotosíntesis")], recommendations: ["Antes."] });
    await call("POST", `/api/sessions/${w1.id}/skills/analyze`, { cookie: t.cookie });
    aiMock.json({ ...AI, skills: [entry("argumentacion", "logrado", "Se pondría amarilla porque no puede hacer la fotosíntesis")], recommendations: ["Después."] });
    await call("POST", `/api/sessions/${w2.id}/skills/analyze`, { cookie: t.cookie });

    const r = await call("GET", `/api/students/${student.id}`, { cookie: t.cookie });
    expect(r.body.skills.assessedWorks).toBe(2);
    const arg = r.body.skills.skills.find((s: { key: string }) => s.key === "argumentacion");
    expect(arg.history.map((h: { activityTitle: string; status: string }) => `${h.activityTitle}:${h.status}`)).toEqual([
      "La fotosíntesis:en_desarrollo",
      "El ciclo del agua:logrado",
    ]);
    expect(r.body.skills.recommendations).toEqual(["Después."]);
    const [row] = await db.select().from(schema.aspectAnalyses).where(eq(schema.aspectAnalyses.sessionId, w2.id));
    expect(row!.skillsAt).toBeTruthy();
  });
});

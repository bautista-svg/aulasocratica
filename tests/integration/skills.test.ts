import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@server/db/client";
import { call, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { courseLabel, schoolStage } from "@server/services/sessions/ai";
import { insertActivity, insertFullWork, insertSession, insertStudent } from "./live-fixtures";

async function setup(over: Parameters<typeof insertActivity>[2] = {}) {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie, "4.º A");
  const activity = await insertActivity(t.id, classroomId, over);
  const student = await insertStudent(classroomId, "Ana Gómez");
  return { t, classroomId, activity, student };
}

type Shown = { indicator: string; quote: string }[];
const entry = (skill: string, status: string, evidence = "", extra: Record<string, string | boolean | Shown> = {}) => ({
  skill,
  analysis: "Muestra el indicador central.",
  shown: [] as Shown,
  repeatsTutor: false,
  status,
  // The AI names an indicator only when the evidence shows it (logrado or more).
  criterion: /logrado|avanzado/i.test(status) ? "Justifica sus respuestas." : "",
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

describe("formative evaluation (Vanina Gerstner, 24-10)", () => {
  it("tells the AI the age of the course and the formative criteria; an idea the student only repeated from the tutor is «inicial» at most", async () => {
    const { t, classroomId, activity, student } = await setup();
    await db.update(schema.classrooms).set({ grade: "4.º grado" }).where(eq(schema.classrooms.id, classroomId));
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      ...AI,
      skills: [
        entry("argumentacion", "logrado", "Se pondría amarilla porque no puede hacer la fotosíntesis"),
        entry("comprension", "logrado", "la clorofila atrapa la luz como un panel solar", { repeatsTutor: true }),
        entry("creatividad", "inicial", "la clorofila atrapa la luz como un panel solar", { repeatsTutor: true }),
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(statusOf(r.body.skills, "argumentacion")).toBe("logrado");
    expect(statusOf(r.body.skills, "comprension")).toBe("inicial");
    expect(statusOf(r.body.skills, "creatividad")).toBe("inicial");

    const req = aiMock.lastRequest()!.body;
    const prompt = JSON.stringify(req);
    expect(prompt).toContain("4.º A · 4.º grado (nivel primario, alrededor de 9 a 10 años)");
    expect(prompt).toContain("evaluación formativa");
    expect(prompt).toContain("Presenta evidencias incipientes y necesita acompañamiento frecuente.");
    expect(prompt).toContain("No hace falta que aparezcan todos los indicadores");
    expect(prompt).toContain("Puede seguir avanzando");
    expect(req.max_tokens).toBe(20_000);
  });

  it("knows the age from the usual ways of naming a course, and says nothing when it is not clear", () => {
    expect(schoolStage("6.º grado")).toBe("nivel primario, alrededor de 11 a 12 años");
    expect(schoolStage("1er grado")).toBe("nivel primario, alrededor de 6 a 7 años");
    expect(schoolStage("3.º año")).toBe("nivel secundario, alrededor de 14 a 15 años");
    expect(schoolStage("Sala de 5")).toBe("nivel inicial, 5 años");
    expect(schoolStage("Year 6")).toBe("nivel primario, alrededor de 10 a 11 años");
    expect(schoolStage("6.º A")).toBeNull();
    expect(schoolStage("")).toBeNull();
    expect(courseLabel({ name: "6.º A", grade: "", division: "" })).toBe("6.º A");
    expect(courseLabel({ name: "Ciencias", grade: "5.º grado", division: "B" })).toBe("Ciencias · 5.º grado B (nivel primario, alrededor de 10 a 11 años)");
  });

  it("counts the works evaluated with the former criteria until they are evaluated again", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json(AI);
    await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    const url = `/api/activities/${activity.id}/skills`;
    expect((await call("GET", url, { cookie: t.cookie })).body.outdatedWorks).toBe(0);
    // Evaluated before the formative criteria.
    await db.update(schema.aspectAnalyses).set({ skillsVersion: 1 }).where(eq(schema.aspectAnalyses.sessionId, session.id));
    expect((await call("GET", url, { cookie: t.cookie })).body.outdatedWorks).toBe(1);
    aiMock.json(AI);
    await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect((await call("GET", url, { cookie: t.cookie })).body.outdatedWorks).toBe(0);
  });
});

describe("indicators the teacher ticks (Vanina Gerstner, 24-10)", () => {
  it("an indicator shown with the student's own words is «logrado»; one the tutor gave or one she unticked is not", async () => {
    const { t, activity, student } = await setup();
    await call("PUT", "/api/skills", {
      cookie: t.cookie,
      body: { enabled: ["argumentacion", "creatividad", "comprension", "pensamiento_critico"], custom: [], off: { comprension: ["Relaciona conceptos entre sí."] } },
    });
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      ...AI,
      skills: [
        // Named with small changes: still that indicator.
        entry("argumentacion", "en_desarrollo", "Se pondría amarilla porque no puede hacer la fotosíntesis", { criterion: "justifica sus respuestas" }),
        entry("creatividad", "inicial", "la clorofila atrapa la luz como un panel solar", { criterion: "Establece conexiones entre ideas diferentes.", repeatsTutor: true }),
        // Close to an indicator without showing it.
        entry("comprension", "en_desarrollo", "la clorofila atrapa la luz como un panel solar", { criterion: "" }),
        // An unticked indicator does not count.
        entry("pensamiento_critico", "en_desarrollo", "Se pondría amarilla porque no puede hacer la fotosíntesis", { criterion: "Relaciona conceptos entre sí." }),
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    const one = (k: string) => r.body.skills.find((s: { skill: string }) => s.skill === k);
    expect(one("argumentacion")).toMatchObject({ status: "logrado", criterion: "Justifica sus respuestas." });
    expect(one("creatividad")).toMatchObject({ status: "inicial", criterion: "" });
    expect(one("comprension")).toMatchObject({ status: "en_desarrollo", criterion: "" });
    expect(one("pensamiento_critico")).toMatchObject({ status: "en_desarrollo", criterion: "" });

    const prompt = JSON.stringify(aiMock.lastRequest()!.body);
    expect(prompt).toContain("Explica con sus palabras las ideas centrales del tema.");
    expect(prompt).not.toContain("Relaciona conceptos entre sí.");
    expect(prompt).toContain("UNO MOSTRADO ES");
    const group = await call("GET", `/api/activities/${activity.id}/skills`, { cookie: t.cookie });
    expect(group.body.skills.find((s: { key: string }) => s.key === "comprension").criteria).toEqual([
      "Explica con sus palabras las ideas centrales del tema.",
      "Aplica lo que entendió a un caso o ejemplo.",
      "Corrige confusiones cuando se las señalan.",
    ]);
  });

  it("saves the unticked indicators, and never all of a skill", async () => {
    const t = await newTeacher();
    const saved = await call("PUT", "/api/skills", {
      cookie: t.cookie,
      body: {
        enabled: ["argumentacion", "comprension"],
        custom: [],
        off: {
          argumentacion: ["Justifica sus respuestas.", "Inventado."],
          comprension: ["Explica con sus palabras las ideas centrales del tema.", "Relaciona conceptos entre sí.", "Aplica lo que entendió a un caso o ejemplo.", "Corrige confusiones cuando se las señalan."],
          magia: ["Algo."],
        },
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.off).toEqual({ argumentacion: ["Justifica sus respuestas."] });
    // The choice shows every indicator, ticked or not.
    expect(saved.body.catalog.find((c: { key: string }) => c.key === "argumentacion").criteria).toHaveLength(3);
    expect((await call("GET", "/api/skills", { cookie: t.cookie })).body.settings.off).toEqual({ argumentacion: ["Justifica sus respuestas."] });
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

describe("re-evaluating the skills of an activity", () => {
  const until = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout");
  };
  const runOf = async (cookie: string, activityId: string) => (await call("GET", `/api/activities/${activityId}/skills`, { cookie })).body.run;

  it("evaluates every work again from scratch and replaces all previous results, teacher corrections included", async () => {
    const { t, classroomId, activity, student } = await setup();
    const ana = await insertFullWork(activity.id, student.id);
    const beto = await insertFullWork(activity.id, (await insertStudent(classroomId, "Beto Ruiz")).id);
    aiMock.json(AI);
    await call("POST", `/api/sessions/${ana.id}/skills/analyze`, { cookie: t.cookie });
    await call("PATCH", `/api/sessions/${ana.id}/skills/comprension`, { cookie: t.cookie, body: { status: "avanzado" } });

    // New criteria: only argumentación, everyone "en desarrollo".
    await call("PUT", "/api/skills", { cookie: t.cookie, body: { enabled: ["argumentacion"], custom: [] } });
    aiMock.setFallback(() => ({ kind: "json", value: { skills: [entry("argumentacion", "en_desarrollo", "Se pondría amarilla porque no puede hacer la fotosíntesis")], recommendations: ["Nueva."] } }));
    const started = await call("POST", `/api/activities/${activity.id}/skills/reevaluate`, { cookie: t.cookie });
    expect(started.status).toBe(202);
    expect(started.body.run).toMatchObject({ status: "running", total: 2 });
    await until(async () => (await runOf(t.cookie, activity.id))?.status !== "running");
    expect(await runOf(t.cookie, activity.id)).toMatchObject({ status: "done", done: 2, failed: 0 });

    for (const id of [ana.id, beto.id]) {
      const d = await call("GET", `/api/sessions/${id}`, { cookie: t.cookie });
      expect(d.body.skills.skills.map((s: { skill: string; status: string; source: string }) => `${s.skill}:${s.status}:${s.source}`)).toEqual(["argumentacion:en_desarrollo:ai"]);
      expect(d.body.skills.recommendations).toEqual(["Nueva."]);
    }
    const g = await call("GET", `/api/activities/${activity.id}/skills`, { cookie: t.cookie });
    expect(g.body).toMatchObject({ assessedWorks: 2, pending: [], outdatedWorks: 0 });
    expect(g.body.skills[0].counts).toMatchObject({ en_desarrollo: 2 });

    const other = await newTeacher();
    expect((await call("POST", `/api/activities/${activity.id}/skills/reevaluate`, { cookie: other.cookie })).status).toBe(404);
  });

  it("keeps the previous results when a work cannot be evaluated, and allows one run at a time", async () => {
    const { t, activity, student } = await setup();
    const ana = await insertFullWork(activity.id, student.id);
    aiMock.json(AI);
    await call("POST", `/api/sessions/${ana.id}/skills/analyze`, { cookie: t.cookie });
    const before = (await call("GET", `/api/sessions/${ana.id}`, { cookie: t.cookie })).body.skills.skills;

    aiMock.setFallback(() => ({ kind: "error", status: 400, type: "invalid_request_error", message: "mock" }));
    const first = await call("POST", `/api/activities/${activity.id}/skills/reevaluate`, { cookie: t.cookie });
    expect(first.status).toBe(202);
    const second = await call("POST", `/api/activities/${activity.id}/skills/reevaluate`, { cookie: t.cookie });
    // Either still running (409) or already finished: never two at once.
    expect([202, 409]).toContain(second.status);
    await until(async () => (await runOf(t.cookie, activity.id))?.status !== "running");
    const run = await runOf(t.cookie, activity.id);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Se mantienen los resultados anteriores");
    expect((await call("GET", `/api/sessions/${ana.id}`, { cookie: t.cookie })).body.skills.skills).toEqual(before);
  });
});

describe("how many indicators each level asks for (Vanina Gerstner, 28-10)", () => {
  const Q1 = "Se pondría amarilla porque no puede hacer la fotosíntesis";
  const Q2 = "la clorofila atrapa la luz como un panel solar";
  const Q3 = "Las plantas transforman la energía de la luz en azúcares";
  const levels = (inicial: number, en_desarrollo: number, logrado: number, avanzado: number) => ({ inicial, en_desarrollo, logrado, avanzado });
  const one = (skills: { skill: string }[], key: string) => skills.find((s) => s.skill === key) as Record<string, unknown> | undefined;
  const until = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("timeout");
  };

  it("saves the numbers per skill, fitted to the ticked indicators", async () => {
    const t = await newTeacher();
    const saved = await call("PUT", "/api/skills", {
      cookie: t.cookie,
      body: {
        enabled: ["argumentacion", "comprension", "creatividad"],
        custom: [],
        off: { comprension: ["Corrige confusiones cuando se las señalan."], redaccion: ["Usa conectores para relacionar ideas.", "Ordena sus ideas de manera que se entienden."] },
        levels: {
          argumentacion: levels(0, 1, 2, 3),
          // Three ticked: Avanzado «4 de 4» is «3 de 3».
          comprension: levels(0, 1, 3, 4),
          // Out of order: the higher levels go up.
          creatividad: levels(0, 2, 1, 0),
          // One indicator ticked: nothing to count.
          redaccion: levels(0, 0, 1, 1),
          magia: levels(0, 1, 2, 3),
        },
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.levels).toEqual({ argumentacion: levels(0, 1, 2, 3), comprension: levels(0, 1, 3, 3), creatividad: levels(0, 2, 2, 2) });
    expect((await call("GET", "/api/skills", { cookie: t.cookie })).body.settings.levels).toEqual(saved.body.settings.levels);
    // Unticking an indicator later fits the numbers again.
    const fewer = await call("PUT", "/api/skills", {
      cookie: t.cookie,
      body: { ...saved.body.settings, off: { ...saved.body.settings.off, argumentacion: ["Explica las razones de sus decisiones."] } },
    });
    expect(fewer.body.settings.levels.argumentacion).toEqual(levels(0, 1, 2, 2));

    const bad = { enabled: ["argumentacion"], custom: [] };
    expect((await call("PUT", "/api/skills", { cookie: t.cookie, body: { ...bad, levels: { argumentacion: levels(-1, 1, 2, 3) } } })).status).toBe(400);
    expect((await call("PUT", "/api/skills", { cookie: t.cookie, body: { ...bad, levels: { argumentacion: { logrado: 2 } } } })).status).toBe(400);
    expect((await call("PUT", "/api/skills", { cookie: t.cookie, body: { ...bad, levels: { argumentacion: levels(0, 1, 2.5, 3) } } })).status).toBe(400);
  });

  it("levels each skill by counting the ticked indicators shown with a real quote, not by the AI's level", async () => {
    const { t, activity, student } = await setup();
    await call("PUT", "/api/skills", {
      cookie: t.cookie,
      body: {
        enabled: ["argumentacion", "comprension", "creatividad", "pensamiento_critico"],
        custom: [],
        off: { comprension: ["Corrige confusiones cuando se las señalan."] },
        levels: { argumentacion: levels(0, 1, 2, 3), comprension: levels(0, 1, 3, 3), creatividad: levels(0, 2, 2, 2), pensamiento_critico: levels(2, 2, 3, 4) },
      },
    });
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      ...AI,
      skills: [
        // Two of three: Logrado (2), not the Avanzado the AI said (3).
        entry("argumentacion", "avanzado", Q1, {
          shown: [
            { indicator: "Justifica sus respuestas.", quote: Q1 },
            { indicator: "explica las razones de sus decisiones", quote: Q3 },
          ],
        }),
        // Three named, but one quote is not the student's and one is repeated: two count, En desarrollo.
        entry("comprension", "logrado", Q2, {
          criterion: "Relaciona conceptos entre sí.",
          shown: [
            { indicator: "Explica con sus palabras las ideas centrales del tema.", quote: Q3 },
            { indicator: "Relaciona conceptos entre sí.", quote: Q2 },
            { indicator: "Relaciona conceptos entre sí.", quote: Q1 },
            { indicator: "Aplica lo que entendió a un caso o ejemplo.", quote: "Pensá en qué parte de la hoja ocurre" },
          ],
        }),
        // None shown: only Inicial asks for none, so the AI's Logrado is Inicial.
        entry("creatividad", "logrado", Q2),
        // One shown, Inicial asks for two: not enough evidence.
        entry("pensamiento_critico", "logrado", Q1, { shown: [{ indicator: "Fundamenta sus conclusiones.", quote: Q1 }] }),
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(one(r.body.skills, "argumentacion")).toMatchObject({
      status: "logrado",
      criterion: "Justifica sus respuestas.",
      met: [
        { criterion: "Justifica sus respuestas.", evidence: Q1 },
        { criterion: "Explica las razones de sus decisiones.", evidence: Q3 },
      ],
      of: 3,
      levels: levels(0, 1, 2, 3),
    });
    expect(one(r.body.skills, "comprension")).toMatchObject({
      status: "en_desarrollo",
      criterion: "Relaciona conceptos entre sí.",
      met: [
        { criterion: "Explica con sus palabras las ideas centrales del tema.", evidence: Q3 },
        { criterion: "Relaciona conceptos entre sí.", evidence: Q2 },
      ],
      of: 3,
    });
    expect(one(r.body.skills, "creatividad")).toMatchObject({ status: "inicial", met: [], of: 4 });
    expect(one(r.body.skills, "pensamiento_critico")).toMatchObject({ status: "sin_evidencia", met: [{ criterion: "Fundamenta sus conclusiones.", evidence: Q1 }] });
    expect(r.body.droppedQuotes).toBe(0);

    const prompt = JSON.stringify(aiMock.lastRequest()!.body);
    expect(prompt).toContain("Cantidad por nivel (la fijó la docente): inicial desde 0, en_desarrollo desde 1, logrado desde 2, avanzado desde 3 (de los 3 indicadores");
    expect(prompt).toContain("Con menos de 2, sin_evidencia");
    expect(prompt).toContain("EXCEPCIÓN");

    // The student's work shows them too.
    const detail = await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie });
    expect(one(detail.body.skills.skills, "argumentacion")).toMatchObject({ met: [{ criterion: "Justifica sus respuestas." }, { criterion: "Explica las razones de sus decisiones." }] });
    expect(detail.body.skills.catalog.find((c: { key: string }) => c.key === "argumentacion").levels).toEqual(levels(0, 1, 2, 3));
  });

  it("without numbers, one indicator shown is still Logrado; the indicators shown are kept", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json({
      ...AI,
      skills: [
        entry("argumentacion", "en_desarrollo", Q1, { criterion: "", shown: [{ indicator: "Justifica sus respuestas.", quote: Q1 }] }),
        // The AI judges depth for Avanzado, as before.
        entry("creatividad", "avanzado", Q2, { criterion: "Establece conexiones entre ideas diferentes." }),
        // A level without a real quote is still no level, whatever it lists.
        entry("comprension", "logrado", "Pensá en qué parte de la hoja ocurre", { shown: [{ indicator: "Relaciona conceptos entre sí.", quote: Q2 }] }),
      ],
    });
    const r = await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect(one(r.body.skills, "argumentacion")).toMatchObject({ status: "logrado", criterion: "Justifica sus respuestas.", met: [{ criterion: "Justifica sus respuestas.", evidence: Q1 }], of: 3, levels: null });
    expect(one(r.body.skills, "creatividad")).toMatchObject({ status: "avanzado", met: [{ criterion: "Establece conexiones entre ideas diferentes.", evidence: Q2 }], of: 4 });
    expect(one(r.body.skills, "comprension")).toMatchObject({ status: "sin_evidencia", met: [], evidence: "" });
    expect(r.body.droppedQuotes).toBe(1);
    expect(JSON.stringify(aiMock.lastRequest()!.body)).not.toContain("Cantidad por nivel (la fijó");
  });

  it("asks to re-evaluate the works leveled with other numbers, and «Reevaluar habilidades» applies the current ones", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    const url = `/api/activities/${activity.id}/skills`;
    const shownTwo = entry("argumentacion", "logrado", Q1, {
      shown: [
        { indicator: "Justifica sus respuestas.", quote: Q1 },
        { indicator: "Explica las razones de sus decisiones.", quote: Q3 },
      ],
    });
    aiMock.json({ ...AI, skills: [shownTwo] });
    await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    expect((await call("GET", url, { cookie: t.cookie })).body).toMatchObject({ outdatedWorks: 0, levelsOutdatedWorks: 0 });

    const settings = (await call("GET", "/api/skills", { cookie: t.cookie })).body.settings;
    await call("PUT", "/api/skills", { cookie: t.cookie, body: { ...settings, levels: { argumentacion: levels(0, 1, 3, 3) } } });
    expect((await call("GET", url, { cookie: t.cookie })).body).toMatchObject({ outdatedWorks: 0, levelsOutdatedWorks: 1 });

    aiMock.setFallback(() => ({ kind: "json", value: { ...AI, skills: [shownTwo] } }));
    expect((await call("POST", `${url}/reevaluate`, { cookie: t.cookie })).status).toBe(202);
    await until(async () => (await call("GET", url, { cookie: t.cookie })).body.run?.status !== "running");
    const after = await call("GET", url, { cookie: t.cookie });
    expect(after.body).toMatchObject({ outdatedWorks: 0, levelsOutdatedWorks: 0 });
    // Two of three, Logrado now asks for three: En desarrollo.
    expect(after.body.skills.find((s: { key: string }) => s.key === "argumentacion").counts).toMatchObject({ en_desarrollo: 1, logrado: 0 });

    // Back to the default rule: those works used numbers, so they are flagged again.
    await call("PUT", "/api/skills", { cookie: t.cookie, body: { ...settings, levels: {} } });
    expect((await call("GET", url, { cookie: t.cookie })).body.levelsOutdatedWorks).toBe(1);
  });
});

describe("the teacher's recommendations", () => {
  it("can be rewritten by the teacher", async () => {
    const { t, activity, student } = await setup();
    const session = await insertFullWork(activity.id, student.id);
    aiMock.json(AI);
    await call("POST", `/api/sessions/${session.id}/skills/analyze`, { cookie: t.cookie });
    const r = await call("PUT", `/api/sessions/${session.id}/skills/recommendations`, { cookie: t.cookie, body: { recommendations: [" Trabajar con mapas. ", "", "Pedirle un ejemplo propio."] } });
    expect(r.status).toBe(200);
    expect(r.body.recommendations).toEqual(["Trabajar con mapas.", "Pedirle un ejemplo propio."]);
    expect((await call("GET", `/api/sessions/${session.id}`, { cookie: t.cookie })).body.skills.recommendations).toEqual(["Trabajar con mapas.", "Pedirle un ejemplo propio."]);
    const other = await newTeacher();
    expect((await call("PUT", `/api/sessions/${session.id}/skills/recommendations`, { cookie: other.cookie, body: { recommendations: [] } })).status).toBe(404);
  });
});

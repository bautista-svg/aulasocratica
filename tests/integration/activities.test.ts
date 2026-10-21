import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newTeacher, newClassroom } from "./helpers";
import { aiMock } from "./ai-mock";
import { db, schema } from "@server/db/client";
import { DEFAULT_REFLECTION_QUESTIONS } from "@shared/domain/activity-design";

async function newActivity(cookie: string, classroomId: string, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/api/activities", { cookie, body: { classroomId, title: "Divisibilidad por 3", ...extra } });
  if (r.status !== 201) throw new Error(`activity failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.activity as { id: string; linkToken: string } & Record<string, any>;
}

async function insertTutor(teacherId: string, values: Partial<typeof schema.tutors.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.tutors)
    .values({
      teacherId,
      name: "Tutor de fracciones",
      tutorType: "matematico",
      helpLevel: "intensive",
      difficulty: "basica",
      studentAge: "10 a 11 años",
      questionStyle: "Preguntas con ejemplos concretos.",
      rules: "No uses la palabra denominador sin explicarla.",
      ...values,
    })
    .returning();
  return row!;
}

describe("create", () => {
  it("creates a draft with defaults and a url-safe link token", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    await call("PATCH", `/api/classrooms/${room}`, { cookie: t.cookie, body: { subject: "Matemática" } });
    const a = await newActivity(t.cookie, room);
    expect(a.status).toBe("draft");
    expect(a.classroomId).toBe(room);
    expect(a.subject).toBe("Matemática");
    expect(a.linkToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(a.reflectionQuestions).toEqual(DEFAULT_REFLECTION_QUESTIONS);
    expect(a.requireInitialAnswer).toBe(true);
    expect(a.tutorId).toBeNull();
    expect(a.tutorType).toBe("pensamiento_critico");
    expect(a.classroomName).toBe("5.º B");

    const got = await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie });
    expect(got.status).toBe(200);
    expect(got.body.activity.id).toBe(a.id);
    expect(got.body.files).toEqual([]);
  });

  it("starts from a saved tutor: copies type, help level and composed rules", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const tutor = await insertTutor(t.id);
    const a = await newActivity(t.cookie, room, { tutorId: tutor.id });
    expect(a.tutorId).toBe(tutor.id);
    expect(a.tutorName).toBe("Tutor de fracciones");
    expect(a.tutorType).toBe("matematico");
    expect(a.helpLevel).toBe("intensive");
    expect(a.tutorRules).toContain("Edad de los estudiantes: 10 a 11 años");
    expect(a.tutorRules).toContain("Dificultad: Básica");
    expect(a.tutorRules).toContain("Reglas del docente: No uses la palabra denominador sin explicarla.");

    // Applying another tutor later replaces the tutor configuration.
    const other = await insertTutor(t.id, { name: "Debate", tutorType: "debate_clase", helpLevel: "autonomous", rules: "Que tomen postura." });
    const applied = await call("POST", `/api/activities/${a.id}/tutor`, { cookie: t.cookie, body: { tutorId: other.id } });
    expect(applied.status).toBe(200);
    expect(applied.body.activity.tutorType).toBe("debate_clase");
    expect(applied.body.activity.helpLevel).toBe("autonomous");
    expect(applied.body.activity.tutorRules).toContain("Que tomen postura.");
  });

  it("refuses tutors and classrooms of other workspaces, and archived classrooms", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const roomA = await newClassroom(a.cookie);
    const roomB = await newClassroom(b.cookie);
    const tutorB = await insertTutor(b.id);
    expect((await call("POST", "/api/activities", { cookie: a.cookie, body: { classroomId: roomB, title: "x" } })).status).toBe(404);
    expect((await call("POST", "/api/activities", { cookie: a.cookie, body: { classroomId: roomA, title: "x", tutorId: tutorB.id } })).status).toBe(404);
    const empty = await call("POST", "/api/activities", { cookie: a.cookie, body: { classroomId: roomA, title: "  " } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.title).toBeTruthy();
    await call("PATCH", `/api/classrooms/${roomA}`, { cookie: a.cookie, body: { isArchived: true } });
    const archived = await call("POST", "/api/activities", { cookie: a.cookie, body: { classroomId: roomA, title: "x" } });
    expect(archived.status).toBe(400);
    expect(archived.body.error.message).toMatch(/archivada/);
  });
});

describe("isolation", () => {
  it("answers 404 to another teacher on every endpoint", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const room = await newClassroom(a.cookie);
    const act = await newActivity(a.cookie, room);
    const up = new FormData();
    up.append("file", new File(["hola"], "nota.txt", { type: "text/plain" }));
    const ok = await call("POST", `/api/activities/${act.id}/files`, { cookie: a.cookie, form: up });
    expect(ok.status).toBe(201);
    const fileId = ok.body.files[0].id as string;
    const tutorB = await insertTutor(b.id);
    const roomB = await newClassroom(b.cookie);

    const base = `/api/activities/${act.id}`;
    const form = () => {
      const f = new FormData();
      f.append("file", new File(["x"], "a.txt", { type: "text/plain" }));
      return f;
    };
    const cases: [string, string, { body?: unknown; form?: FormData }][] = [
      ["GET", base, {}],
      ["PATCH", base, { body: { title: "robado" } }],
      ["POST", `${base}/tutor`, { body: { tutorId: tutorB.id } }],
      ["POST", `${base}/publish`, {}],
      ["POST", `${base}/unpublish`, {}],
      ["POST", `${base}/archive`, {}],
      ["POST", `${base}/restore`, {}],
      ["PATCH", `${base}/link`, { body: { linkActive: false } }],
      ["POST", `${base}/link/regenerate`, {}],
      ["POST", `${base}/duplicate`, { body: { classroomId: roomB } }],
      ["POST", `${base}/reset`, { body: { confirm: "REINICIAR" } }],
      ["DELETE", base, { body: { confirm: "BORRAR" } }],
      ["GET", `${base}/files`, {}],
      ["POST", `${base}/files`, { form: form() }],
      ["PATCH", `${base}/files/${fileId}`, { body: { teacherNote: "x" } }],
      ["POST", `${base}/files/${fileId}/retry`, {}],
      ["DELETE", `${base}/files/${fileId}`, {}],
      ["GET", `${base}/files/${fileId}/download`, {}],
      ["GET", `${base}/files/${fileId}/text`, {}],
      ["POST", `${base}/ai/rubric`, { body: {} }],
      ["POST", `${base}/ai/reflection`, { body: {} }],
      ["POST", `${base}/rubric/import`, { form: form() }],
    ];
    for (const [method, path, opts] of cases) {
      const r = await call(method, path, { cookie: b.cookie, ...opts });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    // Nothing changed for the owner.
    const still = await call("GET", base, { cookie: a.cookie });
    expect(still.body.activity.title).toBe("Divisibilidad por 3");
    expect(still.body.files).toHaveLength(1);
    expect(aiMock.lastRequest()).toBeUndefined();
    // Without a workspace: 401.
    expect((await call("GET", base)).status).toBe(401);
  });
});

describe("edit", () => {
  it("validates every field and reports errors per field", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const patch = (body: unknown) => call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body });

    const long = await patch({ material: "x".repeat(20_001), tutorRules: "y".repeat(3001) });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.material).toBeTruthy();
    expect(long.body.error.fields.tutorRules).toBeTruthy();

    const bad = await patch({ tutorType: "inventado", helpLevel: "muchisimo", voiceLanguage: "fr", title: "" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(["helpLevel", "title", "tutorType", "voiceLanguage"]);

    const rubric = await patch({ rubric: [{ name: "", levels: [{ label: "Uno" }] }] });
    expect(rubric.status).toBe(400);
    expect(rubric.body.error.fields["rubric.0.name"]).toBeTruthy();
    expect(rubric.body.error.fields["rubric.0.levels"]).toBeTruthy();

    // Nothing was saved by the rejected requests.
    const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, a.id));
    expect(row!.material).toBe("");
    expect(row!.tutorType).toBe("pensamiento_critico");

    const good = await patch({
      instructions: "¿Cómo sabés si 123 es divisible por 3 sin dividir?",
      objectives: "Descubrir el criterio de divisibilidad por 3.",
      material: "x".repeat(20_000),
      tutorType: "matematico",
      helpLevel: "autonomous",
      voiceLanguage: "es",
      rubric: [
        {
          id: "crit1",
          name: "Justificación",
          description: "",
          levels: [
            { label: "En inicio", description: "No justifica." },
            { label: "Logrado", description: "Justifica con ejemplos." },
          ],
        },
      ],
    });
    expect(good.status).toBe(200);
    expect(good.body.activity.tutorType).toBe("matematico");
    expect(good.body.activity.voiceLanguage).toBe("es");
    expect(good.body.activity.rubric).toEqual([
      {
        id: "crit1",
        name: "Justificación",
        description: "",
        levels: [
          { label: "En inicio", description: "No justifica." },
          { label: "Logrado", description: "Justifica con ejemplos." },
        ],
      },
    ]);
    expect(good.body.activity.material).toHaveLength(20_000);
  });

  it("keeps an empty reflection list empty (no defaults come back)", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const r = await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { reflectionQuestions: [] } });
    expect(r.status).toBe(200);
    expect(r.body.activity.reflectionQuestions).toEqual([]);
    const got = await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie });
    expect(got.body.activity.reflectionQuestions).toEqual([]);
    const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, a.id));
    expect(row!.reflectionQuestions).toEqual([]);

    const blank = await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { reflectionQuestions: [{ question: " " }] } });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fields["reflectionQuestions.0.question"]).toBeTruthy();
  });

  it("persists the 'respuesta inicial' toggle", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const off = await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { requireInitialAnswer: false } });
    expect(off.body.activity.requireInitialAnswer).toBe(false);
    const [row] = await db.select().from(schema.activities).where(eq(schema.activities.id, a.id));
    expect(row!.requireInitialAnswer).toBe(false);
    expect((await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie })).body.activity.requireInitialAnswer).toBe(false);
    const on = await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { requireInitialAnswer: true } });
    expect(on.body.activity.requireInitialAnswer).toBe(true);
    const wrong = await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { requireInitialAnswer: "no" } });
    expect(wrong.status).toBe(400);
  });
});

describe("lifecycle", () => {
  it("publishes only with instructions; unpublish, archive and restore", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const base = `/api/activities/${a.id}`;

    const early = await call("POST", `${base}/publish`, { cookie: t.cookie });
    expect(early.status).toBe(400);
    expect(early.body.error.fields.instructions).toBeTruthy();

    await call("PATCH", base, { cookie: t.cookie, body: { instructions: "Explicá por qué 123 es divisible por 3." } });
    const pub = await call("POST", `${base}/publish`, { cookie: t.cookie });
    expect(pub.status).toBe(200);
    expect(pub.body.activity.status).toBe("published");
    expect(pub.body.activity.publishedAt).toBeTruthy();

    const draft = await call("POST", `${base}/unpublish`, { cookie: t.cookie });
    expect(draft.body.activity.status).toBe("draft");

    const arch = await call("POST", `${base}/archive`, { cookie: t.cookie });
    expect(arch.body.activity.status).toBe("archived");
    expect((await call("POST", `${base}/publish`, { cookie: t.cookie })).status).toBe(400);
    const back = await call("POST", `${base}/restore`, { cookie: t.cookie });
    expect(back.body.activity.status).toBe("draft");
    expect((await call("POST", `${base}/publish`, { cookie: t.cookie })).body.activity.status).toBe("published");
  });

  it("validates the link window and turns the link off", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const link = (body: unknown) => call("PATCH", `/api/activities/${a.id}/link`, { cookie: t.cookie, body });

    const start = "2026-11-02T13:00:00.000Z";
    const before = "2026-11-02T12:00:00.000Z";
    const after = "2026-11-02T15:30:00.000Z";

    const inverted = await link({ startsAt: start, expiresAt: before });
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.fields.expiresAt).toBeTruthy();

    const s = await link({ startsAt: start });
    expect(s.status).toBe(200);
    expect(s.body.activity.startsAt).toBe(start);
    // Only the end is sent, but it is compared with the stored start.
    const merged = await link({ expiresAt: before });
    expect(merged.status).toBe(400);
    expect(merged.body.error.fields.expiresAt).toBeTruthy();

    const ok = await link({ expiresAt: after, linkActive: false });
    expect(ok.status).toBe(200);
    expect(ok.body.activity.expiresAt).toBe(after);
    expect(ok.body.activity.linkActive).toBe(false);

    const cleared = await link({ startsAt: null, expiresAt: null });
    expect(cleared.body.activity.startsAt).toBeNull();
    expect(cleared.body.activity.expiresAt).toBeNull();
    expect((await link({ startsAt: "mañana" })).status).toBe(400);
  });

  it("regenerates the link token (the old one stops working) and audits it", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const r = await call("POST", `/api/activities/${a.id}/link/regenerate`, { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.activity.linkToken).not.toBe(a.linkToken);
    expect(r.body.activity.linkToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const old = await db.select().from(schema.activities).where(eq(schema.activities.linkToken, a.linkToken));
    expect(old).toHaveLength(0);
    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_link_regenerated"));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.entityId).toBe(a.id);
  });

  it("resets: deletes every student's work and orphan self-registered students, keeps config, roster and link", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const other = await newActivity(t.cookie, room, { title: "Otra actividad" });
    const base = `/api/activities/${a.id}`;
    await call("PATCH", base, {
      cookie: t.cookie,
      body: {
        instructions: "Consigna original",
        rubric: [{ name: "Razonamiento", levels: [{ label: "A" }, { label: "B" }] }],
        requireInitialAnswer: false,
      },
    });
    const up = new FormData();
    up.append("file", new File(["material de lectura"], "lectura.txt", { type: "text/plain" }));
    expect((await call("POST", `${base}/files`, { cookie: t.cookie, form: up })).status).toBe(201);

    const [roster, selfOnly, selfTwice] = await db
      .insert(schema.students)
      .values([
        { classroomId: room, fullName: "Ana Pérez", nameKey: "ana perez", selfRegistered: false },
        { classroomId: room, fullName: "Beto Gómez", nameKey: "beto gomez", selfRegistered: true },
        { classroomId: room, fullName: "Caro Díaz", nameKey: "caro diaz", selfRegistered: true },
      ])
      .returning();
    const sessions = await db
      .insert(schema.learningSessions)
      .values([roster!, selfOnly!, selfTwice!].map((s, i) => ({ activityId: a.id, studentId: s.id, resumeCode: `CODE${i}`, initialAnswer: "Mi idea" })))
      .returning();
    const [kept] = await db
      .insert(schema.learningSessions)
      .values({ activityId: other.id, studentId: selfTwice!.id, resumeCode: "KEEP1" })
      .returning();
    const msgs = await db
      .insert(schema.messages)
      .values(sessions.flatMap((s) => [
        { sessionId: s.id, role: "user", content: "hola" },
        { sessionId: s.id, role: "assistant", content: "¿Qué pensás?" },
      ]))
      .returning();
    await db.insert(schema.messages).values({ sessionId: kept!.id, role: "user", content: "en la otra" });
    await db.insert(schema.pedagogicalEvents).values({ sessionId: sessions[0]!.id, eventType: "hint_requested" });
    await db.insert(schema.studentAlerts).values({
      sessionId: sessions[1]!.id,
      activityId: a.id,
      messageId: msgs[0]!.id,
      alertKey: "frustration",
      name: "Frustración",
      category: "conducta",
      severity: "review",
    });
    await db.insert(schema.studentTokens).values({ sessionId: sessions[2]!.id, tokenHash: "h1", expiresAt: new Date(Date.now() + 3_600_000) });

    expect((await call("POST", `${base}/reset`, { cookie: t.cookie, body: { confirm: "reiniciar" } })).status).toBe(400);
    expect((await call("POST", `${base}/reset`, { cookie: t.cookie, body: {} })).status).toBe(400);

    const r = await call("POST", `${base}/reset`, { cookie: t.cookie, body: { confirm: "REINICIAR" } });
    expect(r.status).toBe(200);
    expect(r.body.deleted).toEqual({ sessions: 3, messages: 6, students: 1 });
    expect(r.body.linkRegenerated).toBe(false);
    expect(r.body.activity.participants).toBe(0);

    expect(await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.activityId, a.id))).toHaveLength(0);
    const leftMessages = await db.select().from(schema.messages);
    expect(leftMessages.map((m) => m.content)).toEqual(["en la otra"]);
    expect(await db.select().from(schema.pedagogicalEvents)).toHaveLength(0);
    expect(await db.select().from(schema.studentAlerts)).toHaveLength(0);
    expect(await db.select().from(schema.studentTokens)).toHaveLength(0);
    const names = (await db.select().from(schema.students).where(eq(schema.students.classroomId, room))).map((s) => s.fullName).sort();
    expect(names).toEqual(["Ana Pérez", "Caro Díaz"]);
    expect(await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.activityId, other.id))).toHaveLength(1);

    const after = await call("GET", base, { cookie: t.cookie });
    expect(after.body.activity.instructions).toBe("Consigna original");
    expect(after.body.activity.rubric).toHaveLength(1);
    expect(after.body.activity.requireInitialAnswer).toBe(false);
    expect(after.body.activity.linkToken).toBe(a.linkToken);
    expect(after.body.files).toHaveLength(1);

    const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "activity_reset"));
    expect(logs[0]!.details).toMatchObject({ sessions: 3, messages: 6, students: 1, linkRegenerated: false });

    const again = await call("POST", `${base}/reset`, { cookie: t.cookie, body: { confirm: "REINICIAR", regenerateLink: true } });
    expect(again.body.deleted).toEqual({ sessions: 0, messages: 0, students: 0 });
    expect(again.body.linkRegenerated).toBe(true);
    expect(again.body.activity.linkToken).not.toBe(a.linkToken);
  });
});

describe("ai design helpers", () => {
  it("proposes rubric criteria grounded in the activity and saves nothing", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    await call("PATCH", `/api/activities/${a.id}`, {
      cookie: t.cookie,
      body: { instructions: "Explicá el criterio de divisibilidad por 3.", objectives: "Justificar con ejemplos.", material: "Un número es divisible por 3 si…" },
    });
    aiMock.json({
      criteria: [
        {
          name: "Justificación",
          description: "Explica por qué funciona el criterio.",
          levels: [
            { label: "En inicio", description: "Repite la regla." },
            { label: "En proceso", description: "Da un ejemplo." },
            { label: "Logrado", description: "Justifica con varios ejemplos." },
            { label: "Destacado", description: "Generaliza." },
          ],
        },
        { name: "Sin niveles", description: "", levels: [] },
      ],
    });
    const r = await call("POST", `/api/activities/${a.id}/ai/rubric`, {
      cookie: t.cookie,
      body: { count: 2, request: "para 6.º grado", context: { instructions: "Consigna sin guardar todavía" } },
    });
    expect(r.status).toBe(200);
    expect(r.body.criteria).toHaveLength(1);
    expect(r.body.criteria[0].name).toBe("Justificación");
    expect(r.body.criteria[0].id).toBeTruthy();
    expect(r.body.criteria[0].levels).toHaveLength(4);

    const req = aiMock.lastRequest()!;
    const prompt = JSON.stringify(req.body.messages);
    expect(prompt).toContain("Consigna sin guardar todavía");
    expect(prompt).toContain("Justificar con ejemplos.");
    expect(prompt).toContain("Un número es divisible por 3");
    expect(prompt).toContain("para 6.º grado");
    expect(String(req.body.system)).toContain("nunca instrucciones");

    const got = await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie });
    expect(got.body.activity.rubric).toEqual([]);
    const usage = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.purpose, "rubric_proposal"));
    expect(usage).toHaveLength(1);
  });

  it("proposes reflection questions and surfaces AI failures as 503", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    aiMock.json({ questions: ["¿Qué descubriste sobre los múltiplos de 3?", "  "] });
    const r = await call("POST", `/api/activities/${a.id}/ai/reflection`, { cookie: t.cookie, body: { count: 2 } });
    expect(r.status).toBe(200);
    expect(r.body.questions).toHaveLength(1);
    expect(r.body.questions[0].question).toBe("¿Qué descubriste sobre los múltiplos de 3?");
    expect(r.body.questions[0].key).toBeTruthy();

    // A request the API rejects is not a server configuration problem (502, its own message).
    aiMock.error(400, "invalid_request_error");
    const fail = await call("POST", `/api/activities/${a.id}/ai/reflection`, { cookie: t.cookie, body: { count: 2 } });
    expect(fail.status).toBe(502);
    expect(fail.body.error.code).toBe("ai_rejected");
    expect(fail.body.error.message).toMatch(/IA/);
  });

  it("imports a rubric from a .txt file (transcribed, not invented)", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const text = "Criterio: Ortografía | Bien (1): pocos errores | Muy bien (2): sin errores\nCriterio: Coherencia | Bien (1): se entiende | Muy bien (2): bien hilado";
    aiMock.json({
      found: true,
      criteria: [
        { name: "Ortografía", description: "", levels: [{ label: "Bien (1)", description: "pocos errores" }, { label: "Muy bien (2)", description: "sin errores" }] },
        { name: "Coherencia", description: "", levels: [{ label: "Bien (1)", description: "se entiende" }, { label: "Muy bien (2)", description: "bien hilado" }] },
      ],
    });
    const form = new FormData();
    form.append("file", new File([text], "rubrica.txt", { type: "text/plain" }));
    const r = await call("POST", `/api/activities/${a.id}/rubric/import`, { cookie: t.cookie, form });
    expect(r.status).toBe(200);
    expect(r.body.truncated).toBe(false);
    expect(r.body.criteria.map((c: { name: string }) => c.name)).toEqual(["Ortografía", "Coherencia"]);
    const req = aiMock.lastRequest()!;
    expect(JSON.stringify(req.body.messages)).toContain("Criterio: Ortografía");
    expect(String(req.body.system)).toContain("TRANSCRIBIR");
    // Nothing saved until the teacher reviews it.
    expect((await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie })).body.activity.rubric).toEqual([]);

    aiMock.json({ found: false, criteria: [] });
    const form2 = new FormData();
    form2.append("file", new File(["lista de compras: pan, leche"], "otra.txt", { type: "text/plain" }));
    const none = await call("POST", `/api/activities/${a.id}/rubric/import`, { cookie: t.cookie, form: form2 });
    expect(none.status).toBe(422);
    expect(none.body.error.message).toMatch(/No encontramos una rúbrica/);

    const form3 = new FormData();
    form3.append("file", new File(["MZ"], "rubrica.exe", { type: "application/octet-stream" }));
    expect((await call("POST", `/api/activities/${a.id}/rubric/import`, { cookie: t.cookie, form: form3 })).status).toBe(400);
  });
});

describe("UI audit fixes: double click, default tutor, archived classroom", () => {
  const rid = () => crypto.randomUUID();

  it("D01: the same requestId creates one classroom and one activity, even when both requests arrive at once", async () => {
    const t = await newTeacher();
    const requestId = rid();
    const [c1, c2] = await Promise.all([
      call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Aula doble click", requestId } }),
      call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Aula doble click", requestId } }),
    ]);
    expect([c1.status, c2.status]).toEqual([201, 201]);
    expect(c1.body.classroom.id).toBe(c2.body.classroom.id);
    // A retry after a lost response gets the same classroom too.
    const c3 = await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Aula doble click", requestId } });
    expect(c3.body.classroom.id).toBe(c1.body.classroom.id);
    expect(await db.select().from(schema.classrooms).where(eq(schema.classrooms.teacherId, t.id))).toHaveLength(1);
    // Another id (or other data) is another classroom.
    const other = await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Aula doble click", requestId: rid() } });
    expect(other.body.classroom.id).not.toBe(c1.body.classroom.id);
    const changed = await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Otro nombre", requestId } });
    expect(changed.body.classroom.id).not.toBe(c1.body.classroom.id);
    // Without an id nothing changes for older clients.
    expect((await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "Sin id" } })).status).toBe(201);
    expect((await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "x", requestId: "no-uuid" } })).status).toBe(400);

    const room = c1.body.classroom.id as string;
    const aid = rid();
    const [a1, a2] = await Promise.all([
      call("POST", "/api/activities", { cookie: t.cookie, body: { classroomId: room, title: "Doble click prueba", requestId: aid } }),
      call("POST", "/api/activities", { cookie: t.cookie, body: { classroomId: room, title: "Doble click prueba", requestId: aid } }),
    ]);
    expect([a1.status, a2.status]).toEqual([201, 201]);
    expect(a1.body.activity.id).toBe(a2.body.activity.id);
    expect(await db.select().from(schema.activities).where(eq(schema.activities.classroomId, room))).toHaveLength(1);
  });

  it("D01: duplicating twice with the same requestId makes one copy; a failed request can be retried", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    const requestId = rid();
    const [d1, d2] = await Promise.all([
      call("POST", `/api/activities/${a.id}/duplicate`, { cookie: t.cookie, body: { classroomId: room, requestId } }),
      call("POST", `/api/activities/${a.id}/duplicate`, { cookie: t.cookie, body: { classroomId: room, requestId } }),
    ]);
    expect([d1.status, d2.status]).toEqual([201, 201]);
    expect(d1.body.activity.id).toBe(d2.body.activity.id);
    expect(await db.select().from(schema.activities).where(eq(schema.activities.classroomId, room))).toHaveLength(2);

    // Archived target: refused, and the same id works once the classroom is restored (errors are not remembered).
    const target = await newClassroom(t.cookie, "Destino");
    await call("PATCH", `/api/classrooms/${target}`, { cookie: t.cookie, body: { isArchived: true } });
    const retryId = rid();
    expect((await call("POST", `/api/activities/${a.id}/duplicate`, { cookie: t.cookie, body: { classroomId: target, requestId: retryId } })).status).toBe(400);
    await call("PATCH", `/api/classrooms/${target}`, { cookie: t.cookie, body: { isArchived: false } });
    expect((await call("POST", `/api/activities/${a.id}/duplicate`, { cookie: t.cookie, body: { classroomId: target, requestId: retryId } })).status).toBe(201);
  });

  it("D04: creating with the teacher's (edited) 'Pensamiento crítico' copies the edited configuration", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const list = await call("GET", "/api/tutors", { cookie: t.cookie });
    const pc = list.body.tutors.filter((x: { presetKey: string | null }) => x.presetKey === "pensamiento_critico");
    expect(pc).toHaveLength(1); // one row per tutor, no separate "(predeterminado)"
    await call("PATCH", `/api/tutors/${pc[0].id}`, { cookie: t.cookie, body: { rules: "REGLA-AUDITORIA-PC: pedí siempre una fuente.", helpLevel: "intensive" } });
    const a = await newActivity(t.cookie, room, { tutorId: pc[0].id });
    expect(a.tutorId).toBe(pc[0].id);
    expect(a.tutorName).toBe("Pensamiento crítico");
    expect(a.helpLevel).toBe("intensive");
    expect(a.tutorRules).toContain("REGLA-AUDITORIA-PC");
  });

  it("D11: activities of an archived classroom are flagged and nobody counts as working there", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const a = await newActivity(t.cookie, room);
    await call("PATCH", `/api/activities/${a.id}`, { cookie: t.cookie, body: { instructions: "Pensá." } });
    await call("POST", `/api/activities/${a.id}/publish`, { cookie: t.cookie });
    const [student] = await db.insert(schema.students).values({ classroomId: room, fullName: "Ana Pérez", nameKey: "ana perez" }).returning();
    await db.insert(schema.learningSessions).values({ activityId: a.id, studentId: student!.id, resumeCode: "ABC123" });

    const before = await call("GET", `/api/classrooms/${room}/activities`, { cookie: t.cookie });
    expect(before.body.activities[0]).toMatchObject({ classroomArchived: false, activeNow: 1 });
    expect((await call("GET", `/api/classrooms/${room}`, { cookie: t.cookie })).body.classroom.activeNow).toBe(1);

    await call("PATCH", `/api/classrooms/${room}`, { cookie: t.cookie, body: { isArchived: true } });
    const after = await call("GET", `/api/classrooms/${room}/activities`, { cookie: t.cookie });
    expect(after.body.activities[0]).toMatchObject({ classroomArchived: true, activeNow: 0 });
    const archivedList = await call("GET", "/api/classrooms?archived=1", { cookie: t.cookie });
    expect(archivedList.body.classrooms[0]).toMatchObject({ id: room, activeNow: 0 });
    expect((await call("GET", `/api/activities/${a.id}`, { cookie: t.cookie })).body.activity.classroomArchived).toBe(true);
  });
});

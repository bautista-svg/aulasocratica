import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newTeacher, newClassroom } from "./helpers";
import { db, schema } from "@server/db/client";
import { TUTOR_TYPES } from "@shared/domain/pedagogy";
import { presetValues } from "@shared/domain/tutor-presets";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function presetCount(teacherId: string) {
  const rows = await db.select({ id: schema.tutors.id }).from(schema.tutors).where(eq(schema.tutors.teacherId, teacherId));
  return rows.length;
}

describe("tutor presets", () => {
  it("seeds the 18 built-in tutors once, even with concurrent first visits", async () => {
    const a = await newTeacher();
    const [r1, r2, r3] = await Promise.all([
      call("GET", "/api/tutors", { cookie: a.cookie }),
      call("GET", "/api/tutors", { cookie: a.cookie }),
      call("GET", "/api/tutors", { cookie: a.cookie }),
    ]);
    for (const r of [r1, r2, r3]) expect(r.status).toBe(200);
    expect(await presetCount(a.id)).toBe(18);
    const again = await call("GET", "/api/tutors", { cookie: a.cookie });
    expect(again.body.tutors).toHaveLength(18);
    expect(await presetCount(a.id)).toBe(18);

    const keys = again.body.tutors.map((t: { presetKey: string }) => t.presetKey).sort();
    expect(keys).toEqual(Object.keys(TUTOR_TYPES).sort());
    const mat = again.body.tutors.find((t: { presetKey: string }) => t.presetKey === "matematico");
    expect(mat).toMatchObject({ name: "Matemático", tutorType: "matematico", customized: false, usedInActivities: 0 });

    const [teacher] = await db.select().from(schema.teachers).where(eq(schema.teachers.id, a.id));
    expect(teacher!.tutorsSeededAt).not.toBeNull();
    // Presets come sorted by name.
    const names = again.body.tutors.map((t: { name: string }) => t.name);
    expect(names).toEqual([...names].sort((x: string, y: string) => x.localeCompare(y, "es")));
  });

  it("returns the full detail of a preset with its template texts", async () => {
    const a = await newTeacher();
    const list = await call("GET", "/api/tutors", { cookie: a.cookie });
    const t = list.body.tutors.find((x: { presetKey: string }) => x.presetKey === "escritura_mano");
    const d = await call("GET", `/api/tutors/${t.id}`, { cookie: a.cookie });
    expect(d.status).toBe(200);
    const original = presetValues("escritura_mano")!;
    expect(d.body.tutor).toMatchObject({
      name: original.name,
      questionStyle: original.questionStyle,
      strategies: original.strategies,
      closingCriteria: original.closingCriteria,
      objectives: original.objectives,
    });
    expect(d.body.tutor.objectives.length).toBeGreaterThan(10);
  });

  it("edits a preset (marked as customized) and restores the original", async () => {
    const a = await newTeacher();
    const list = await call("GET", "/api/tutors", { cookie: a.cookie });
    const t = list.body.tutors.find((x: { presetKey: string }) => x.presetKey === "repaso");
    const edit = await call("PATCH", `/api/tutors/${t.id}`, {
      cookie: a.cookie,
      body: { rules: "Usá ejemplos de fútbol.", studentAge: "11 a 12 años", helpLevel: "intensive" },
    });
    expect(edit.status).toBe(200);
    expect(edit.body.tutor).toMatchObject({ rules: "Usá ejemplos de fútbol.", studentAge: "11 a 12 años", helpLevel: "intensive", customized: true });
    // Other fields stay as they were.
    expect(edit.body.tutor.questionStyle).toBe(presetValues("repaso")!.questionStyle);

    const listed = await call("GET", "/api/tutors", { cookie: a.cookie });
    expect(listed.body.tutors.find((x: { id: string }) => x.id === t.id).customized).toBe(true);

    const restored = await call("POST", `/api/tutors/${t.id}/restore`, { cookie: a.cookie });
    expect(restored.status).toBe(200);
    expect(restored.body.tutor).toMatchObject({ rules: "", studentAge: "", helpLevel: "moderate", customized: false, name: "Repaso" });

    // Editing a preset back to its exact original is not "customized" either.
    await call("PATCH", `/api/tutors/${t.id}`, { cookie: a.cookie, body: { rules: "x" } });
    const back = await call("PATCH", `/api/tutors/${t.id}`, { cookie: a.cookie, body: { rules: "" } });
    expect(back.body.tutor.customized).toBe(false);

    const bad = await call("PATCH", `/api/tutors/${t.id}`, { cookie: a.cookie, body: { tutorType: "inventado" } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.tutorType).toBeTruthy();
  });

  it("duplicates any tutor as a custom one and lists custom tutors first", async () => {
    const a = await newTeacher();
    const list = await call("GET", "/api/tutors", { cookie: a.cookie });
    const t = list.body.tutors.find((x: { presetKey: string }) => x.presetKey === "debate_socratico");
    await call("PATCH", `/api/tutors/${t.id}`, { cookie: a.cookie, body: { rules: "Tema: la pena de muerte." } });
    const dup = await call("POST", `/api/tutors/${t.id}/duplicate`, { cookie: a.cookie });
    expect(dup.status).toBe(201);
    expect(dup.body.tutor).toMatchObject({ presetKey: null, name: "Debate socrático (copia)", rules: "Tema: la pena de muerte.", tutorType: "debate_socratico", customized: false });
    await sleep(5);
    const created = await call("POST", "/api/tutors", {
      cookie: a.cookie,
      body: { name: "Profe de Historia", tutorType: "conversacion_personaje", rules: "Sos Manuel Belgrano." },
    });
    expect(created.status).toBe(201);
    const after = await call("GET", "/api/tutors", { cookie: a.cookie });
    expect(after.body.tutors).toHaveLength(20);
    expect(after.body.tutors[0].id).toBe(created.body.tutor.id);
    expect(after.body.tutors[1].id).toBe(dup.body.tutor.id);
    expect(after.body.tutors.slice(2).every((x: { presetKey: string | null }) => x.presetKey)).toBe(true);
  });

  it("deletes custom tutors only; activities keep their copied configuration", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const list = await call("GET", "/api/tutors", { cookie: a.cookie });
    const preset = list.body.tutors[0];
    const delPreset = await call("DELETE", `/api/tutors/${preset.id}`, { cookie: a.cookie });
    expect(delPreset.status).toBe(400);
    expect(await presetCount(a.id)).toBe(18);

    const custom = await call("POST", "/api/tutors", { cookie: a.cookie, body: { name: "Mío", tutorType: "matematico", rules: "Reglas mías" } });
    const tutorId = custom.body.tutor.id as string;
    const [act] = await db
      .insert(schema.activities)
      .values({ classroomId: room, teacherId: a.id, title: "Fracciones", tutorId, tutorType: "matematico", tutorRules: "Reglas del docente: Reglas mías", linkToken: `tok-${Date.now()}` })
      .returning();
    const used = await call("GET", `/api/tutors/${tutorId}`, { cookie: a.cookie });
    expect(used.body.tutor.usedInActivities).toBe(1);

    const del = await call("DELETE", `/api/tutors/${tutorId}`, { cookie: a.cookie });
    expect(del.status).toBe(200);
    expect((await call("GET", `/api/tutors/${tutorId}`, { cookie: a.cookie })).status).toBe(404);
    const [kept] = await db.select().from(schema.activities).where(eq(schema.activities.id, act!.id));
    expect(kept!.tutorId).toBeNull();
    expect(kept!.tutorRules).toBe("Reglas del docente: Reglas mías");
  });

  it("isolates workspaces: another teacher gets 404", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const list = await call("GET", "/api/tutors", { cookie: a.cookie });
    const id = list.body.tutors[0].id;
    expect((await call("GET", `/api/tutors/${id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("PATCH", `/api/tutors/${id}`, { cookie: b.cookie, body: { rules: "x" } })).status).toBe(404);
    expect((await call("POST", `/api/tutors/${id}/restore`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("POST", `/api/tutors/${id}/duplicate`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("DELETE", `/api/tutors/${id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("GET", "/api/tutors/no-es-un-uuid", { cookie: b.cookie })).status).toBe(404);
    expect((await call("GET", "/api/tutors")).status).toBe(401);
  });

  it("validates the body of a new tutor", async () => {
    const a = await newTeacher();
    const r = await call("POST", "/api/tutors", { cookie: a.cookie, body: { name: " ", tutorType: "matematico" } });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.name).toBe("Poné un nombre.");
    const long = await call("POST", "/api/tutors", { cookie: a.cookie, body: { name: "X", tutorType: "matematico", rules: "a".repeat(3001) } });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.rules).toMatch(/3000/);
  });
});

describe("UI audit fixes in Mis tutores", () => {
  it("D01: the same requestId creates one tutor / one copy; duplicating without a body still works", async () => {
    const a = await newTeacher();
    await call("GET", "/api/tutors", { cookie: a.cookie });
    const requestId = crypto.randomUUID();
    const body = { name: "Tutor doble click", tutorType: "matematico", requestId };
    const [c1, c2] = await Promise.all([call("POST", "/api/tutors", { cookie: a.cookie, body }), call("POST", "/api/tutors", { cookie: a.cookie, body })]);
    expect([c1.status, c2.status]).toEqual([201, 201]);
    expect(c1.body.tutor.id).toBe(c2.body.tutor.id);
    const mine = () => db.select().from(schema.tutors).where(eq(schema.tutors.teacherId, a.id));
    expect((await mine()).filter((t) => !t.presetKey)).toHaveLength(1);

    const dupId = crypto.randomUUID();
    const [d1, d2] = await Promise.all([
      call("POST", `/api/tutors/${c1.body.tutor.id}/duplicate`, { cookie: a.cookie, body: { requestId: dupId } }),
      call("POST", `/api/tutors/${c1.body.tutor.id}/duplicate`, { cookie: a.cookie, body: { requestId: dupId } }),
    ]);
    expect(d1.body.tutor.id).toBe(d2.body.tutor.id);
    expect((await mine()).filter((t) => !t.presetKey)).toHaveLength(2);
    const legacy = await call("POST", `/api/tutors/${c1.body.tutor.id}/duplicate`, { cookie: a.cookie });
    expect(legacy.status).toBe(201);
    expect((await mine()).filter((t) => !t.presetKey)).toHaveLength(3);
  });
});

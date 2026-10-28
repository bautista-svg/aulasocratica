// Divisions of a classroom (N, F, S…): listed in the classroom, picked by each student when
// entering an activity, shown and filtered in the live view and in the classroom's students.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertSession, insertStudent } from "./live-fixtures";
import { db, schema } from "@server/db/client";
import { randomToken } from "@server/lib/crypto";
import { cookieName } from "@server/services/student/session";

async function classroomWith(divisionOptions: string[]) {
  const t = await newTeacher();
  const classroomId = await newClassroom(t.cookie, "1.º año");
  const r = await call("PATCH", `/api/classrooms/${classroomId}`, { cookie: t.cookie, body: { divisionOptions } });
  expect(r.status).toBe(200);
  const token = randomToken(12);
  const activity = await insertActivity(t.id, classroomId, { status: "published", publishedAt: new Date(), linkToken: token });
  return { t, classroomId, activity, token };
}

async function divisionOf(classroomId: string, fullName: string) {
  const all = await db.select().from(schema.students).where(eq(schema.students.classroomId, classroomId));
  return all.find((x) => x.fullName === fullName)?.division;
}

describe("divisions of a classroom", () => {
  it("are saved clean, checked, and kept when other fields change", async () => {
    const t = await newTeacher();
    const r = await call("POST", "/api/classrooms", { cookie: t.cookie, body: { name: "1.º año", school: "Escuela 3", divisionOptions: [" N", "F", "n", "S "] } });
    expect(r.status).toBe(201);
    expect(r.body.classroom.divisionOptions).toEqual(["N", "F", "S"]);
    const id = r.body.classroom.id;

    const long = await call("PATCH", `/api/classrooms/${id}`, { cookie: t.cookie, body: { divisionOptions: ["x".repeat(21)] } });
    expect(long.status).toBe(400);
    expect(long.body.error.fields.divisionOptions).toMatch(/hasta 20 caracteres/);
    const many = await call("PATCH", `/api/classrooms/${id}`, { cookie: t.cookie, body: { divisionOptions: Array.from({ length: 13 }, (_, i) => `D${i}`) } });
    expect(many.status).toBe(400);
    expect(many.body.error.fields.divisionOptions).toMatch(/hasta 12/);

    // Archiving (a PATCH with one field) keeps the rest: zod 4 used to fill in the defaults.
    const archived = await call("PATCH", `/api/classrooms/${id}`, { cookie: t.cookie, body: { isArchived: true } });
    expect(archived.status).toBe(200);
    expect(archived.body.classroom).toMatchObject({ isArchived: true, school: "Escuela 3", divisionOptions: ["N", "F", "S"] });

    const cleared = await call("PATCH", `/api/classrooms/${id}`, { cookie: t.cookie, body: { divisionOptions: [] } });
    expect(cleared.body.classroom.divisionOptions).toEqual([]);
  });
});

describe("entering an activity with a division", () => {
  it("is not asked when the classroom has none (as before)", async () => {
    const s = await classroomWith([]);
    const info = await call("GET", `/api/s/${s.token}`);
    expect(info.body.activity.divisions).toEqual([]);
    const r = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Lucía Gómez", division: "N" } });
    expect(r.status).toBe(201);
    expect(await divisionOf(s.classroomId, "Lucía Gómez")).toBe("");
  });

  it("is required and must be one of the classroom's", async () => {
    const s = await classroomWith(["N", "F", "S"]);
    const info = await call("GET", `/api/s/${s.token}`);
    expect(info.body.activity.divisions).toEqual(["N", "F", "S"]);

    const missing = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Lucía Gómez" } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.division).toBe("Elegí tu división.");
    const wrong = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Lucía Gómez", division: "X" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.division).toBeTruthy();
    // Nothing was created by the failed tries.
    expect(await db.select().from(schema.students).where(eq(schema.students.classroomId, s.classroomId))).toHaveLength(0);

    const ok = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Lucía Gómez", division: "f" } });
    expect(ok.status).toBe(201);
    expect(await divisionOf(s.classroomId, "Lucía Gómez")).toBe("F");
  });

  it("updates the division of a student already on the list", async () => {
    const s = await classroomWith(["N", "F", "S"]);
    await insertStudent(s.classroomId, "Bruno Pérez");
    const r = await call("POST", `/api/s/${s.token}/join`, { body: { name: "bruno perez", division: "S" } });
    expect(r.status).toBe(201);
    expect(await divisionOf(s.classroomId, "Bruno Pérez")).toBe("S");

    // Same device entering again (e.g. after a reload): the new pick is kept.
    const cookie = cookiePair(r.cookies, cookieName(s.activity.id));
    const again = await call("POST", `/api/s/${s.token}/join`, { cookie, body: { name: "Bruno Pérez", division: "N" } });
    expect(again.status).toBe(200);
    expect(await divisionOf(s.classroomId, "Bruno Pérez")).toBe("N");
  });

  it("works when continuing with the code on another device", async () => {
    const s = await classroomWith(["N", "F", "S"]);
    const first = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Camila Ruiz", division: "N" } });
    const code = first.body.workspace.resumeCode;

    const busy = await call("POST", `/api/s/${s.token}/join`, { body: { name: "Camila Ruiz", division: "F" } });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("resume_required");

    const missing = await call("POST", `/api/s/${s.token}/resume`, { body: { name: "Camila Ruiz", code } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.division).toBeTruthy();

    const ok = await call("POST", `/api/s/${s.token}/resume`, { body: { name: "Camila Ruiz", code, division: "F" } });
    expect(ok.status).toBe(200);
    expect(await divisionOf(s.classroomId, "Camila Ruiz")).toBe("F");
  });
});

describe("live view by division", () => {
  it("sends each participant's division and the filter's choices with their counts", async () => {
    const s = await classroomWith(["N", "F", "S"]);
    for (const [name, division] of [
      ["Ana", "N"],
      ["Beto", "N"],
      ["Carla", "S"],
      ["Dani", ""],
    ] as const) {
      const r = await call("POST", `/api/s/${s.token}/join`, { body: { name, division: division || "N" } });
      expect(r.status).toBe(201);
      if (!division) await db.update(schema.students).set({ division: "" }).where(eq(schema.students.fullName, name));
    }
    // Someone who picked a division the teacher later removed from the list.
    const old = await insertStudent(s.classroomId, "Eva");
    await db.update(schema.students).set({ division: "B" }).where(eq(schema.students.id, old.id));
    await insertSession(s.activity.id, old.id);

    const r = await call("GET", `/api/live/${s.activity.id}`, { cookie: s.t.cookie });
    expect(r.status).toBe(200);
    const byName = Object.fromEntries(r.body.participants.map((p: { studentName: string; division: string }) => [p.studentName, p.division]));
    expect(byName).toEqual({ Ana: "N", Beto: "N", Carla: "S", Dani: "", Eva: "B" });
    expect(r.body.divisions).toEqual([
      { value: "N", count: 2 },
      { value: "F", count: 0 },
      { value: "S", count: 1 },
      { value: "B", count: 1 },
      { value: "", count: 1 },
    ]);
  });

  it("has no filter when the classroom has no divisions and nobody picked one", async () => {
    const s = await classroomWith([]);
    await call("POST", `/api/s/${s.token}/join`, { body: { name: "Ana" } });
    const r = await call("GET", `/api/live/${s.activity.id}`, { cookie: s.t.cookie });
    expect(r.body.divisions).toEqual([]);
    expect(r.body.participants[0].division).toBe("");
  });
});

describe("students of the classroom", () => {
  it("show the division and let the teacher correct it", async () => {
    const s = await classroomWith(["N", "F", "S"]);
    await call("POST", `/api/s/${s.token}/join`, { body: { name: "Lucía Gómez", division: "N" } });
    const list = await call("GET", `/api/classrooms/${s.classroomId}/students`, { cookie: s.t.cookie });
    const lucia = list.body.students[0];
    expect(lucia.division).toBe("N");
    const url = `/api/classrooms/${s.classroomId}/students/${lucia.id}`;

    const wrong = await call("PATCH", url, { cookie: s.t.cookie, body: { division: "X" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.division).toBeTruthy();

    expect((await call("PATCH", url, { cookie: s.t.cookie, body: { division: "s" } })).status).toBe(200);
    expect(await divisionOf(s.classroomId, "Lucía Gómez")).toBe("S");
    // The name is untouched when only the division changes, and both can change at once.
    expect((await call("PATCH", url, { cookie: s.t.cookie, body: { fullName: "Lucía M. Gómez", division: "" } })).status).toBe(200);
    expect(await divisionOf(s.classroomId, "Lucía M. Gómez")).toBe("");

    // A division the teacher removed from the list can stay as it is.
    await db.update(schema.students).set({ division: "B" }).where(eq(schema.students.id, lucia.id));
    expect((await call("PATCH", url, { cookie: s.t.cookie, body: { fullName: "Lucía Gómez", division: "B" } })).status).toBe(200);
    expect(await divisionOf(s.classroomId, "Lucía Gómez")).toBe("B");

    // Another teacher's student: 404.
    const other = await newTeacher();
    const otherRoom = await newClassroom(other.cookie);
    expect((await call("PATCH", `/api/classrooms/${otherRoom}/students/${lucia.id}`, { cookie: other.cookie, body: { division: "N" } })).status).toBe(404);
  });
});

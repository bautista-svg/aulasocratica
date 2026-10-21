import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newClassroom, newTeacher } from "./helpers";
import { db, schema } from "@server/db/client";
import { humanCode, randomToken } from "@server/lib/crypto";
import { nameKey } from "@shared/domain/names";

async function seedActivity(teacherId: string, classroomId: string, over: Partial<typeof schema.activities.$inferInsert> = {}) {
  const [a] = await db
    .insert(schema.activities)
    .values({ teacherId, classroomId, title: "Actividad", linkToken: randomToken(), status: "published", publishedAt: new Date(), ...over })
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

async function seedAlert(sessionId: string, activityId: string, over: Partial<typeof schema.studentAlerts.$inferInsert> = {}) {
  await db.insert(schema.studentAlerts).values({
    sessionId,
    activityId,
    alertKey: "comprehension_gap",
    name: "Brecha de comprensión",
    category: "academica",
    severity: "review",
    ...over,
  });
}

describe("dashboard", () => {
  it("starts empty with the onboarding checklist pending", async () => {
    const t = await newTeacher();
    const r = await call("GET", "/api/dashboard", { cookie: t.cookie });
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ classrooms: 0, activities: 0, published: 0, students: 0, openAlerts: 0 });
    expect(r.body.onboarding).toMatchObject({ hasClassroom: false, hasActivity: false, hasPublished: false, hasStudentSession: false, done: false });
    expect(r.body.live).toEqual([]);
    expect(r.body.recent).toEqual([]);
    expect(r.body.workspace).toEqual({ displayName: "", hasAccount: false });
    expect((await call("GET", "/api/dashboard")).status).toBe(401);
  });

  it("follows the checklist step by step from real data", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie, "6.º A");
    let o = (await call("GET", "/api/dashboard", { cookie: t.cookie })).body.onboarding;
    expect(o).toMatchObject({ hasClassroom: true, hasActivity: false, classroomId: room });
    const draft = await seedActivity(t.id, room, { status: "draft", publishedAt: null });
    o = (await call("GET", "/api/dashboard", { cookie: t.cookie })).body.onboarding;
    expect(o).toMatchObject({ hasActivity: true, hasPublished: false, draftActivityId: draft.id });
    await db.update(schema.activities).set({ status: "published", publishedAt: new Date() }).where(eq(schema.activities.id, draft.id));
    o = (await call("GET", "/api/dashboard", { cookie: t.cookie })).body.onboarding;
    expect(o).toMatchObject({ hasPublished: true, hasStudentSession: false, publishedActivityId: draft.id, done: false });
    const st = await seedStudent(room, "Lucía Ferro");
    await seedSession(draft.id, st.id);
    o = (await call("GET", "/api/dashboard", { cookie: t.cookie })).body.onboarding;
    expect(o).toMatchObject({ hasStudentSession: true, done: true });
  });

  it("counts, live activities, alerts and recent activities come from the database", async () => {
    const t = await newTeacher();
    await call("PATCH", "/api/auth/me", { cookie: t.cookie, body: { displayName: "Profe Laura" } });
    const room = await newClassroom(t.cookie, "5.º B");
    const old = await newClassroom(t.cookie, "Aula archivada");
    const open = await seedActivity(t.id, room, { title: "Fracciones" });
    await seedActivity(t.id, room, { title: "Borrador", status: "draft", publishedAt: null });
    const closed = await seedActivity(t.id, room, { title: "Enlace cerrado", linkActive: false });
    const hidden = await seedActivity(t.id, old, { title: "En aula archivada" });
    await call("PATCH", `/api/classrooms/${old}`, { cookie: t.cookie, body: { isArchived: true } });

    const [ana, beto, ceci] = [await seedStudent(room, "Ana Gómez"), await seedStudent(room, "Beto Ruiz"), await seedStudent(room, "Ceci Paz")];
    await seedStudent(old, "Dani Sol");
    const now = Date.now();
    const s1 = await seedSession(open.id, ana.id, { lastActivityAt: new Date(now - 30_000) });
    await seedSession(open.id, beto.id, { lastActivityAt: new Date(now - 60_000) });
    await seedSession(open.id, ceci.id, { lastActivityAt: new Date(now - 10 * 60_000) }); // idle
    await seedSession(closed.id, ana.id, { lastActivityAt: new Date(now - 20_000) }); // link closed: not "en clase"
    const s5 = await seedSession(hidden.id, (await seedStudent(old, "Eli Mar")).id, { lastActivityAt: new Date(now - 5_000) });

    await seedAlert(s1.id, open.id, { createdAt: new Date(now - 60_000) });
    await seedAlert(s1.id, open.id, {
      alertKey: "safety_signal",
      name: "Señal de seguridad",
      category: "seguridad",
      severity: "immediate",
      createdAt: new Date(now - 120_000),
    });
    await seedAlert(s1.id, open.id, { status: "reviewed" });
    await seedAlert(s5.id, hidden.id); // archived classroom, still open: counts as pending review

    const r = await call("GET", "/api/dashboard", { cookie: t.cookie });
    expect(r.status).toBe(200);
    const d = r.body;
    expect(d.workspace.displayName).toBe("Profe Laura");
    expect(d.counts).toEqual({ classrooms: 1, activities: 3, published: 2, students: 3, openAlerts: 3 });

    expect(d.live).toHaveLength(1);
    expect(d.live[0]).toMatchObject({
      id: open.id,
      title: "Fracciones",
      classroomName: "5.º B",
      activeNow: 2,
      participants: 3,
      completed: 0,
      openAlerts: 2,
    });

    expect(d.alerts).toHaveLength(3);
    expect(d.alerts[0]).toMatchObject({ severity: "immediate", studentName: "Ana Gómez", activityTitle: "Fracciones", sessionId: s1.id });
    expect(d.alerts.map((a: { name: string }) => a.name)).not.toContain(undefined);

    const recentIds = d.recent.map((a: { id: string }) => a.id);
    expect(recentIds).toHaveLength(3);
    expect(recentIds).not.toContain(hidden.id);
    expect(d.recent[0].classroomName).toBe("5.º B");
    expect(d.onboarding.done).toBe(true);
  });

  it("never shows another workspace's data", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const act = await seedActivity(a.id, room);
    const st = await seedStudent(room, "Ana Gómez");
    const s = await seedSession(act.id, st.id);
    await seedAlert(s.id, act.id);
    const b = await newTeacher();
    const r = await call("GET", "/api/dashboard", { cookie: b.cookie });
    expect(r.body.counts).toEqual({ classrooms: 0, activities: 0, published: 0, students: 0, openAlerts: 0 });
    expect(r.body.live).toEqual([]);
    expect(r.body.alerts).toEqual([]);
    expect(r.body.recent).toEqual([]);
    expect(JSON.stringify(r.body)).not.toContain("Ana Gómez");
  });
});

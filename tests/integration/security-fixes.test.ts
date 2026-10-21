// Regression tests for the fixes from the independent security review (docs/informes/seguridad).
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { db, schema } from "@server/db/client";
import { humanCode, randomToken } from "@server/lib/crypto";
import { nameKey } from "@shared/domain/names";

async function seedWork(teacherId: string, classroomId: string, studentName: string) {
  const [a] = await db
    .insert(schema.activities)
    .values({ teacherId, classroomId, title: "Fracciones", instructions: "¿Qué fracción es mayor?", linkToken: randomToken(), status: "published", publishedAt: new Date() })
    .returning();
  const [st] = await db.insert(schema.students).values({ classroomId, fullName: studentName, nameKey: nameKey(studentName) }).returning();
  const [se] = await db
    .insert(schema.learningSessions)
    .values({ activityId: a!.id, studentId: st!.id, resumeCode: humanCode(6), initialAnswer: "Creo que 1/2.", finalAnswer: "1/2 es mayor que 1/3.", status: "completed", completedAt: new Date() })
    .returning();
  return { activity: a!, student: st!, session: se! };
}

describe("F-05 password change rotates the recovery code", () => {
  it("returns a new code and the old one stops working", async () => {
    const t = await newTeacher();
    const reg = await call("POST", "/api/auth/register", { cookie: t.cookie, body: { email: "f05@x.com", password: "clave-original-1" } });
    const ch = await call("POST", "/api/auth/password", { cookie: t.cookie, body: { currentPassword: "clave-original-1", newPassword: "clave-nueva-0002" } });
    expect(ch.status).toBe(200);
    expect(ch.body.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    const old = await call("POST", "/api/auth/recover", { body: { email: "f05@x.com", recoveryCode: reg.body.recoveryCode, newPassword: "otra-clave-0003" } });
    expect(old.status).toBe(401);
    const fresh = await call("POST", "/api/auth/recover", { body: { email: "f05@x.com", recoveryCode: ch.body.recoveryCode, newPassword: "otra-clave-0003" } });
    expect(fresh.status).toBe(200);
  });
});

describe("F-06 disk quota per workspace", () => {
  it("refuses uploads beyond the quota with a clear message", async () => {
    const t = await newTeacher();
    // Pretend the library already holds ~2 GB.
    await db.insert(schema.materials).values({ teacherId: t.id, title: "Grande", kind: "file", sizeBytes: 2047 * 1024 * 1024 });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "text/plain" }), "notas.txt");
    const r = await call("POST", "/api/materials/files", { cookie: t.cookie, form });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("storage_quota");
  });
});

describe("F-02 AI spending caps", () => {
  it("stops AI calls when the service-wide daily cap is reached", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const { activity } = await seedWork(t.id, room, "Ana López");
    // $50 of output tokens today (cap in tests: default US$ 40).
    await db.insert(schema.aiUsage).values({ teacherId: null, purpose: "tutor_chat", model: "claude-haiku-5-5", outputTokens: 100_000_000 });
    const r = await call("POST", `/api/activities/${activity.id}/ai/reflection`, { cookie: t.cookie, body: {} });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("ai_quota_global");
  });

  it("counts cache reads at their real (lower) price for the workspace cap", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const { activity } = await seedWork(t.id, room, "Ana López");
    // 100M cached tokens cost US$ 1 at Haiku cache-read prices: under the US$ 3 cap.
    await db.insert(schema.aiUsage).values({ teacherId: t.id, purpose: "tutor_chat", model: "claude-haiku-5-5", inputTokens: 100_000_000, cacheReadTokens: 100_000_000 });
    aiMock.json({ questions: [{ question: "¿Qué estrategia usaste?" }, { question: "¿Qué cambiarías?" }] });
    const r = await call("POST", `/api/activities/${activity.id}/ai/reflection`, { cookie: t.cookie, body: {} });
    // The cap must not trigger.
    expect(r.status).not.toBe(429);
    expect(["ai_quota", "ai_quota_global"]).not.toContain(r.body?.error?.code);
  });
});

describe("F-04 reports follow deletions", () => {
  it("deletes individual reports and redacts the name in group reports when a student is deleted", async () => {
    const t = await newTeacher();
    const room = await newClassroom(t.cookie);
    const { student, activity } = await seedWork(t.id, room, "Valentina Ruiz");
    const ind = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "individual", scope: { studentId: student.id } } });
    expect(ind.status).toBe(201);
    const grp = await call("POST", "/api/reports", { cookie: t.cookie, body: { kind: "group", scope: { activityId: activity.id } } });
    expect(grp.status).toBe(201);
    const sectionKey = Object.keys(grp.body.report.narrative)[0]!;
    await call("PATCH", `/api/reports/${grp.body.report.id}`, {
      cookie: t.cookie,
      body: { narrative: { ...grp.body.report.narrative, [sectionKey]: "Valentina Ruiz necesitó más pistas." } },
    });

    const del = await call("DELETE", `/api/classrooms/${room}/students/${student.id}`, { cookie: t.cookie });
    expect(del.status).toBe(200);

    expect((await call("GET", `/api/reports/${ind.body.report.id}`, { cookie: t.cookie })).status).toBe(404);
    const g = await db.select().from(schema.reports).where(eq(schema.reports.id, grp.body.report.id));
    const serialized = JSON.stringify(g[0] ?? {});
    expect(serialized).not.toContain("Valentina Ruiz");
  });
});

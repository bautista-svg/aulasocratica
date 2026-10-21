import { describe, expect, it } from "vitest";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { db, schema } from "@server/db/client";
import { env } from "@server/env";
import { humanCode, randomToken } from "@server/lib/crypto";
import { nameKey } from "@shared/domain/names";
import { estimateCostUsd } from "@shared/contracts/admin";

const PASSWORD = "test-admin-password-123456"; // vitest.config.ts

async function adminCookie(): Promise<string> {
  const r = await call("POST", "/api/admin/login", { body: { password: PASSWORD } });
  expect(r.status).toBe(200);
  return cookiePair(r.cookies, "as_admin");
}

describe("admin: sign-in", () => {
  it("rejects a wrong password and sets a strict, httpOnly, path-scoped cookie on success", async () => {
    const bad = await call("POST", "/api/admin/login", { body: { password: "no-es-esta" } });
    expect(bad.status).toBe(401);
    expect(bad.cookies.find((c) => c.startsWith("as_admin="))).toBeUndefined();

    const ok = await call("POST", "/api/admin/login", { body: { password: PASSWORD } });
    expect(ok.status).toBe(200);
    const raw = ok.cookies.find((c) => c.startsWith("as_admin="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/api\/admin/i);
    expect(raw).toMatch(/Max-Age=28800/i);
    const cookie = cookiePair(ok.cookies, "as_admin");
    expect((await call("GET", "/api/admin/session", { cookie })).body.authenticated).toBe(true);
    expect((await call("GET", "/api/admin/session")).body.authenticated).toBe(false);
  });

  it("locks the IP after 5 failures; a spoofed X-Forwarded-For does not bypass it", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/api/admin/login", { body: { password: `mala-${i}` } })).status).toBe(401);
    }
    const locked = await call("POST", "/api/admin/login", { body: { password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.cookies.find((c) => c.startsWith("as_admin="))).toBeUndefined();
    for (const ip of ["203.0.113.7", "198.51.100.1, 10.0.0.1"]) {
      const spoofed = await call("POST", "/api/admin/login", {
        body: { password: PASSWORD },
        headers: { "x-forwarded-for": ip, "cf-connecting-ip": ip.split(",")[0]! },
      });
      expect(spoofed.status).toBe(429);
    }
    const failures = await db.select().from(schema.auditLogs);
    expect(failures.filter((f) => f.action === "admin_login_failed")).toHaveLength(5);
  });

  it("requires a valid, unexpired, untampered session", async () => {
    expect((await call("GET", "/api/admin/overview")).status).toBe(401);
    const cookie = await adminCookie();
    const [name, value] = cookie.split("=") as [string, string];
    const parts = value.split(".");
    parts[1] = String(Number(parts[1]) + 3_600_000); // extend the expiry without re-signing
    expect((await call("GET", "/api/admin/overview", { cookie: `${name}=${parts.join(".")}` })).status).toBe(401);
    expect((await call("GET", "/api/admin/overview", { cookie: `${name}=v1.1.2.3` })).status).toBe(401);
    expect((await call("GET", "/api/admin/overview", { cookie })).status).toBe(200);
    // Signing out revokes the token even if someone kept a copy.
    expect((await call("POST", "/api/admin/logout", { cookie })).status).toBe(200);
    expect((await call("GET", "/api/admin/overview", { cookie })).status).toBe(401);
  });

  it("does not exist when ADMIN_PASSWORD is empty", async () => {
    const prev = env.ADMIN_PASSWORD;
    env.ADMIN_PASSWORD = "";
    try {
      expect((await call("POST", "/api/admin/login", { body: { password: "" } })).status).toBe(404);
      expect((await call("GET", "/api/admin/overview")).status).toBe(404);
      expect((await call("GET", "/api/admin/session")).status).toBe(404);
    } finally {
      env.ADMIN_PASSWORD = prev;
    }
  });
});

describe("admin: overview and workspaces", () => {
  it("shows totals and AI usage (estimated cost) without student names or content", async () => {
    const t = await newTeacher();
    await call("POST", "/api/auth/register", {
      cookie: t.cookie,
      body: { email: "laura.perez@escuela.edu.ar", password: "una-clave-larga", displayName: "Profe Laura" },
    });
    const room = await newClassroom(t.cookie, "Aula privada");
    const [act] = await db
      .insert(schema.activities)
      .values({ teacherId: t.id, classroomId: room, title: "Tema secreto", linkToken: randomToken(), status: "published", publishedAt: new Date() })
      .returning();
    const [st] = await db
      .insert(schema.students)
      .values({ classroomId: room, fullName: "Juana Secreta", nameKey: nameKey("Juana Secreta") })
      .returning();
    const [s] = await db
      .insert(schema.learningSessions)
      .values({ activityId: act!.id, studentId: st!.id, resumeCode: humanCode(6) })
      .returning();
    await db.insert(schema.messages).values({ sessionId: s!.id, role: "user", content: "mensaje privado del alumno" });
    await db.insert(schema.aiUsage).values([
      { teacherId: t.id, purpose: "tutor_chat", model: "m", inputTokens: 1_000_000, outputTokens: 200_000 },
      { teacherId: t.id, purpose: "tutor_chat", model: "m", inputTokens: 500_000, outputTokens: 100_000, ok: false },
      { teacherId: t.id, purpose: "report_narrative", model: "m", inputTokens: 2_000, outputTokens: 1_000 },
      { teacherId: null, purpose: "tutor_chat", model: "m", inputTokens: 10, outputTokens: 10, createdAt: new Date(Date.now() - 40 * 86_400_000) },
    ]);
    await newTeacher(); // a second, empty workspace

    const cookie = await adminCookie();
    const r = await call("GET", "/api/admin/overview", { cookie });
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual({
      workspaces: 2,
      withAccount: 1,
      active7: 2,
      active30: 2,
      suspended: 0,
      classrooms: 1,
      activities: 1,
      published: 1,
      studentSessions: 1,
      messages7: 1,
    });
    expect(r.body.ai.days).toHaveLength(14);
    const today = r.body.ai.days.at(-1);
    expect(today).toMatchObject({ calls: 3, failed: 1, inputTokens: 1_502_000, outputTokens: 301_000 });
    expect(today.costUsd).toBeCloseTo(estimateCostUsd(1_502_000, 301_000), 4);
    expect(today.costUsd).toBeCloseTo(0.3007, 4);
    const chat = r.body.ai.byPurpose.find((p: { purpose: string }) => p.purpose === "tutor_chat");
    expect(chat).toMatchObject({ calls: 2, inputTokens: 1_500_000, outputTokens: 300_000 });
    expect(r.body.ai.pricePerMTok).toEqual({ input: 0.1, output: 0.5 });

    const list = await call("GET", "/api/admin/workspaces", { cookie });
    expect(list.status).toBe(200);
    expect(list.body.workspaces).toHaveLength(2);
    const ws = list.body.workspaces.find((w: { id: string }) => w.id === t.id);
    expect(ws).toMatchObject({
      shortId: t.id.slice(0, 8),
      hasAccount: true,
      maskedEmail: "l***@e***.ar",
      classrooms: 1,
      activities: 1,
      studentSessions: 1,
      aiTokensToday: 1_803_000,
      suspended: false,
    });
    const everything = JSON.stringify([r.body, list.body]);
    for (const secret of ["Juana Secreta", "mensaje privado", "laura.perez", "Profe Laura", "Aula privada", "Tema secreto"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("paginates workspaces with a cursor", async () => {
    const base = Date.now();
    await db.insert(schema.teachers).values(Array.from({ length: 27 }, (_, i) => ({ createdAt: new Date(base - i * 1000) })));
    const cookie = await adminCookie();
    const p1 = await call("GET", "/api/admin/workspaces", { cookie });
    expect(p1.body.workspaces).toHaveLength(25);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await call("GET", `/api/admin/workspaces?cursor=${encodeURIComponent(p1.body.nextCursor)}`, { cookie });
    expect(p2.body.workspaces).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
    const ids = new Set([...p1.body.workspaces, ...p2.body.workspaces].map((w: { id: string }) => w.id));
    expect(ids.size).toBe(27);
    // A malformed cursor starts from the beginning instead of failing.
    expect((await call("GET", "/api/admin/workspaces?cursor=%%%", { cookie })).body.workspaces).toHaveLength(25);
  });

  it("suspending a workspace blocks its requests (403) until it is restored", async () => {
    const t = await newTeacher();
    await newClassroom(t.cookie);
    const cookie = await adminCookie();
    expect((await call("POST", `/api/admin/workspaces/${t.id}/suspend`, { cookie: "" })).status).toBe(401);
    const s = await call("POST", `/api/admin/workspaces/${t.id}/suspend`, { cookie });
    expect(s.status).toBe(200);
    expect(s.body.suspended).toBe(true);
    const blocked = await call("GET", "/api/classrooms", { cookie: t.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("suspended");
    expect((await call("GET", "/api/admin/overview", { cookie })).body.totals.suspended).toBe(1);
    const list = await call("GET", "/api/admin/workspaces", { cookie });
    expect(list.body.workspaces[0].suspended).toBe(true);

    expect((await call("POST", `/api/admin/workspaces/${t.id}/unsuspend`, { cookie })).status).toBe(200);
    expect((await call("GET", "/api/classrooms", { cookie: t.cookie })).status).toBe(200);
    const actions = (await db.select().from(schema.auditLogs)).map((a) => a.action);
    expect(actions).toContain("workspace_suspended");
    expect(actions).toContain("workspace_unsuspended");
    expect((await call("POST", "/api/admin/workspaces/00000000-0000-4000-8000-000000000000/suspend", { cookie })).status).toBe(404);
    expect((await call("POST", "/api/admin/workspaces/not-a-uuid/suspend", { cookie })).status).toBe(404);
  });

  it("rejects admin mutations from another origin (CSRF)", async () => {
    const t = await newTeacher();
    const cookie = await adminCookie();
    const r = await call("POST", `/api/admin/workspaces/${t.id}/suspend`, { cookie, origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });
});

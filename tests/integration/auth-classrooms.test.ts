import { describe, expect, it } from "vitest";
import { call, cookiePair, newTeacher, newClassroom } from "./helpers";

describe("workspace without account", () => {
  it("creates an anonymous workspace with a secure httpOnly cookie", async () => {
    const r = await call("POST", "/api/auth/start", { body: {} });
    expect(r.status).toBe(201);
    expect(r.body.teacher.hasAccount).toBe(false);
    const raw = r.cookies.find((c) => c.startsWith("as_t="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    const me = await call("GET", "/api/auth/me", { cookie: cookiePair(r.cookies, "as_t") });
    expect(me.body.teacher.id).toBe(r.body.teacher.id);
  });

  it("works from a plain HTML form (no JavaScript) and redirects to /app", async () => {
    const r = await call("POST", "/api/auth/start", { headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/app");
  });

  it("rejects mutations from another origin (CSRF)", async () => {
    const r = await call("POST", "/api/auth/start", { body: {}, origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("adds an account, signs in on another device and merges that device's work", async () => {
    const a = await newTeacher();
    const reg = await call("POST", "/api/auth/register", { cookie: a.cookie, body: { email: "Ana@Escuela.edu.ar", password: "una-clave-larga" } });
    expect(reg.status).toBe(200);
    expect(reg.body.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);

    // Another device: worked anonymously first, then signs in.
    const b = await newTeacher();
    const roomB = await newClassroom(b.cookie, "Aula del celular");
    const login = await call("POST", "/api/auth/login", { cookie: b.cookie, body: { email: "ana@escuela.edu.ar", password: "una-clave-larga" } });
    expect(login.status).toBe(200);
    expect(login.body.merged).toBe(true);
    const cookie = cookiePair(login.cookies, "as_t");
    const list = await call("GET", "/api/classrooms", { cookie });
    expect(list.body.classrooms.map((c: { id: string }) => c.id)).toContain(roomB);
  });

  it("does not reveal whether an email exists on failed sign-in", async () => {
    const r1 = await call("POST", "/api/auth/login", { body: { email: "nadie@x.com", password: "x" } });
    expect(r1.status).toBe(401);
    expect(r1.body.error.message).toBe("El correo o la contraseña no coinciden.");
  });

  it("recovers the password with the recovery code and rotates it", async () => {
    const a = await newTeacher();
    const reg = await call("POST", "/api/auth/register", { cookie: a.cookie, body: { email: "b@b.com", password: "otra-clave-larga" } });
    const rec = await call("POST", "/api/auth/recover", {
      body: { email: "b@b.com", recoveryCode: reg.body.recoveryCode.toLowerCase(), newPassword: "clave-nueva-123" },
    });
    expect(rec.status).toBe(200);
    expect(rec.body.recoveryCode).not.toBe(reg.body.recoveryCode);
    const again = await call("POST", "/api/auth/recover", {
      body: { email: "b@b.com", recoveryCode: reg.body.recoveryCode, newPassword: "clave-nueva-456" },
    });
    expect(again.status).toBe(401);
  });

  it("refuses to sign out an anonymous workspace (it would be lost)", async () => {
    const a = await newTeacher();
    const r = await call("POST", "/api/auth/logout", { cookie: a.cookie });
    expect(r.status).toBe(400);
  });

  it("deletes a workspace only with the typed confirmation", async () => {
    const a = await newTeacher();
    expect((await call("DELETE", "/api/auth/workspace", { cookie: a.cookie, body: { confirm: "no" } })).status).toBe(400);
    expect((await call("DELETE", "/api/auth/workspace", { cookie: a.cookie, body: { confirm: "BORRAR" } })).status).toBe(200);
    expect((await call("GET", "/api/classrooms", { cookie: a.cookie })).status).toBe(401);
  });
});

describe("classrooms", () => {
  it("isolates workspaces: another teacher gets 404, never the data", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const room = await newClassroom(a.cookie);
    expect((await call("GET", `/api/classrooms/${room}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("PATCH", `/api/classrooms/${room}`, { cookie: b.cookie, body: { name: "x" } })).status).toBe(404);
    expect((await call("DELETE", `/api/classrooms/${room}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("GET", "/api/classrooms", { cookie: b.cookie })).body.classrooms).toHaveLength(0);
  });

  it("keeps the course's teacher («Docente») and lets it change", async () => {
    const a = await newTeacher();
    const r = await call("POST", "/api/classrooms", { cookie: a.cookie, body: { name: "6.º A", teacherName: "Laura Gómez", grade: "6.º grado" } });
    expect(r.status).toBe(201);
    expect(r.body.classroom).toMatchObject({ teacherName: "Laura Gómez", subject: "" });
    const p = await call("PATCH", `/api/classrooms/${r.body.classroom.id}`, { cookie: a.cookie, body: { teacherName: "Martín Ruiz" } });
    expect(p.body.classroom.teacherName).toBe("Martín Ruiz");
    expect((await call("PATCH", `/api/classrooms/${r.body.classroom.id}`, { cookie: a.cookie, body: { teacherName: "x".repeat(81) } })).status).toBe(400);
  });

  it("validates input with per-field messages", async () => {
    const a = await newTeacher();
    const r = await call("POST", "/api/classrooms", { cookie: a.cookie, body: { name: "" } });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.name).toBeTruthy();
  });

  it("archives and restores", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    await call("PATCH", `/api/classrooms/${room}`, { cookie: a.cookie, body: { isArchived: true } });
    expect((await call("GET", "/api/classrooms", { cookie: a.cookie })).body.classrooms).toHaveLength(0);
    expect((await call("GET", "/api/classrooms?archived=1", { cookie: a.cookie })).body.classrooms).toHaveLength(1);
    await call("PATCH", `/api/classrooms/${room}`, { cookie: a.cookie, body: { isArchived: false } });
    expect((await call("GET", "/api/classrooms", { cookie: a.cookie })).body.classrooms).toHaveLength(1);
  });

  it("adds a roster without duplicates (accents and case ignored)", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const r = await call("POST", `/api/classrooms/${room}/students`, { cookie: a.cookie, body: { names: ["María Pérez", "maria perez", "Juan Gómez"] } });
    expect(r.body.added).toBe(2);
    const list = await call("GET", `/api/classrooms/${room}/students`, { cookie: a.cookie });
    expect(list.body.students.map((s: { fullName: string }) => s.fullName).sort()).toEqual(["Juan Gómez", "María Pérez"]);
  });

  it("keeps safety alerts always on", async () => {
    const a = await newTeacher();
    const room = await newClassroom(a.cookie);
    const r = await call("PUT", `/api/classrooms/${room}/alerts/builtin/safety_signal`, { cookie: a.cookie, body: { enabled: false } });
    expect(r.status).toBe(400);
    const ok = await call("PUT", `/api/classrooms/${room}/alerts/builtin/low_engagement`, { cookie: a.cookie, body: { enabled: false } });
    expect(ok.status).toBe(200);
    const alerts = await call("GET", `/api/classrooms/${room}/alerts`, { cookie: a.cookie });
    expect(alerts.body.builtins.find((x: { key: string }) => x.key === "low_engagement").enabled).toBe(false);
    expect(alerts.body.builtins.find((x: { key: string }) => x.key === "safety_signal").enabled).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { insertActivity, insertSession, insertStudent } from "./live-fixtures";
import { db, schema } from "@server/db/client";
import { setGoogleFetch } from "@server/auth/google";
import { resetClassroomCache } from "@server/services/classroom";

const CLIENT_ID = "test-client.apps.googleusercontent.com"; // vitest.config.ts
const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
].join(" ");
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

interface Seen {
  method: string;
  url: string;
  body: unknown;
}

/** Google, token endpoint and Classroom API, in memory. */
function fakeGoogle(opts: { scope?: string; refreshFails?: boolean } = {}) {
  const seen: Seen[] = [];
  let nonce = "";
  setGoogleFetch(async (url, init) => {
    const method = init.method ?? "GET";
    const raw = typeof init.body === "string" ? init.body : "";
    seen.push({ method, url, body: raw.startsWith("{") ? JSON.parse(raw) : raw });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(raw);
      if (p.get("grant_type") === "refresh_token") return opts.refreshFails ? json({ error: "invalid_grant" }, 400) : json({ access_token: "at-2", expires_in: 3600 });
      const claims = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, sub: "g-1", email: "Profe@Escuela.edu.ar", email_verified: true, nonce };
      return json({ id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.firma`, access_token: "at-1", expires_in: 3600, refresh_token: "rt-secreto", scope: opts.scope ?? `openid email ${SCOPES}` });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return json({});
    const path = url.replace("https://classroom.googleapis.com/v1", "");
    if (path.startsWith("/courses?")) return json({ courses: [{ id: "c1", name: "2.º A", section: "Historia", alternateLink: "https://classroom.google.com/c/c1" }] });
    if (path.startsWith("/courses/c1/students")) {
      return json({ students: [{ userId: "u1", profile: { name: { fullName: "Martina López" } } }, { userId: "u2", profile: { name: { fullName: "Tomás Ruiz" } } }] });
    }
    if (path === "/courses/c1/courseWork" && method === "POST") return json({ id: "cw1", alternateLink: "https://classroom.google.com/c/c1/a/cw1" });
    if (path.startsWith("/courses/c1/courseWork/cw1/studentSubmissions?")) return json({ studentSubmissions: [{ id: "s1", userId: "u1" }, { id: "s2", userId: "u2" }] });
    if (path.startsWith("/courses/c1/courseWork/cw1/studentSubmissions/s1")) return json({});
    return json({ error: { message: "not found" } }, 404);
  });
  return { seen, setNonce: (n: string) => (nonce = n) };
}

/** Connects the teacher's workspace through the real redirect flow. */
async function connect(cookie: string, google: ReturnType<typeof fakeGoogle>, next = "/app/cuenta") {
  const start = await call("GET", `/api/classroom/connect?next=${encodeURIComponent(next)}`, { cookie });
  expect(start.status).toBe(302);
  const url = new URL(start.headers.get("location")!);
  google.setNonce(url.searchParams.get("nonce")!);
  const flow = cookiePair(start.cookies, "as_g");
  return { url, back: await call("GET", `/api/auth/google/callback?code=c0d1g0&state=${encodeURIComponent(url.searchParams.get("state")!)}`, { cookie: `${cookie}; ${flow}` }) };
}

afterEach(() => {
  setGoogleFetch(null);
  resetClassroomCache();
});

describe("Google Classroom", () => {
  it("se conecta con la pantalla de Google pidiendo Classroom sin conexión, y guarda el token cifrado", async () => {
    const t = await newTeacher();
    expect((await call("GET", "/api/classroom/status", { cookie: t.cookie })).body).toEqual({ available: true, connected: false, email: null, missingScopes: false });
    const google = fakeGoogle();
    const { url, back } = await connect(t.cookie, google);
    expect(url.searchParams.get("scope")).toContain("classroom.coursework.students");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/google/callback");
    expect(back.headers.get("location")).toBe("/app/cuenta?classroom=conectado");
    expect((await call("GET", "/api/classroom/status", { cookie: t.cookie })).body).toEqual({ available: true, connected: true, email: "profe@escuela.edu.ar", missingScopes: false });
    const [row] = await db.select().from(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, t.id));
    expect(row!.refreshToken).not.toContain("rt-secreto");
  });

  it("no conecta otro espacio con un flujo ajeno, y avisa si faltan permisos", async () => {
    const a = await newTeacher();
    const b = await newTeacher();
    const google = fakeGoogle({ scope: "openid email https://www.googleapis.com/auth/classroom.courses.readonly" });
    const start = await call("GET", "/api/classroom/connect?next=/app/cuenta", { cookie: a.cookie });
    google.setNonce(new URL(start.headers.get("location")!).searchParams.get("nonce")!);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const stolen = await call("GET", `/api/auth/google/callback?code=x&state=${state}`, { cookie: `${b.cookie}; ${cookiePair(start.cookies, "as_g")}` });
    expect(stolen.headers.get("location")).toBe("/app/cuenta?classroom=vencido");
    expect((await call("GET", "/api/classroom/status", { cookie: b.cookie })).body.connected).toBe(false);

    await connect(a.cookie, google);
    expect((await call("GET", "/api/classroom/status", { cookie: a.cookie })).body.missingScopes).toBe(true);
  });

  it("publica la actividad como tarea, empareja por nombre y pasa la nota de la rúbrica", async () => {
    const t = await newTeacher();
    const google = fakeGoogle();
    await connect(t.cookie, google);
    const roomId = await newClassroom(t.cookie);
    const activity = await insertActivity(t.id, roomId);
    const martina = await insertStudent(roomId, "martina lopez");
    const session = await insertSession(activity.id, martina.id);
    await db.insert(schema.rubricAssessments).values({ sessionId: session.id, teacherLevels: { arg: 2, evid: 1 }, status: "confirmed" });

    expect((await call("GET", "/api/classroom/courses", { cookie: t.cookie })).body.courses).toEqual([
      { id: "c1", name: "2.º A", section: "Historia", url: "https://classroom.google.com/c/c1" },
    ]);
    const pub = await call("POST", `/api/classroom/activities/${activity.id}/publish`, { cookie: t.cookie, body: { courseId: "c1", maxPoints: 10, dueDate: "2026-11-20" } });
    expect(pub.status).toBe(201);
    expect(pub.body.link).toMatchObject({ courseId: "c1", courseworkId: "cw1", courseName: "2.º A · Historia", maxPoints: 10 });
    const created = google.seen.find((s) => s.method === "POST" && s.url.endsWith("/courses/c1/courseWork"))!.body as Record<string, any>;
    expect(created).toMatchObject({ title: "La fotosíntesis", workType: "ASSIGNMENT", state: "PUBLISHED", maxPoints: 10, dueDate: { year: 2026, month: 11, day: 21 } });
    expect(created.materials[0].link.url).toBe(`http://localhost:5173/clase/${activity.linkToken}`);
    expect((await call("POST", `/api/classroom/activities/${activity.id}/publish`, { cookie: t.cookie, body: { courseId: "c1", maxPoints: 10 } })).status).toBe(409);

    const grades = await call("GET", `/api/classroom/activities/${activity.id}/grades`, { cookie: t.cookie });
    expect(grades.status).toBe(200);
    expect(grades.body.rows).toEqual([
      expect.objectContaining({ sessionId: session.id, studentName: "martina lopez", suggestedGrade: 10, source: "confirmed", userId: "u1", sent: null }),
    ]);

    const sent = await call("POST", `/api/classroom/activities/${activity.id}/grades`, {
      cookie: t.cookie,
      body: { items: [{ sessionId: session.id, userId: "u1", grade: 9.5 }], returnToStudents: true },
    });
    expect(sent.body).toEqual({ sent: 1, failed: [] });
    const patch = google.seen.find((s) => s.method === "PATCH")!;
    expect(patch.url).toContain("/studentSubmissions/s1?updateMask=draftGrade,assignedGrade");
    expect(patch.body).toEqual({ draftGrade: 9.5, assignedGrade: 9.5 });
    expect(google.seen.some((s) => s.method === "POST" && s.url.endsWith("/studentSubmissions/s1:return"))).toBe(true);
    const again = await call("GET", `/api/classroom/activities/${activity.id}/grades`, { cookie: t.cookie });
    expect(again.body.rows[0].sent).toMatchObject({ grade: 9.5, returned: true });
  });

  it("trae los alumnos de un curso al aula sin repetir", async () => {
    const t = await newTeacher();
    const google = fakeGoogle();
    await connect(t.cookie, google);
    const roomId = await newClassroom(t.cookie);
    await insertStudent(roomId, "Martina López");
    const r = await call("POST", `/api/classroom/classrooms/${roomId}/import`, { cookie: t.cookie, body: { courseId: "c1" } });
    expect(r.body).toEqual({ added: 1, skipped: 1 });
    const names = (await db.select().from(schema.students).where(eq(schema.students.classroomId, roomId))).map((s) => s.fullName).sort();
    expect(names).toEqual(["Martina López", "Tomás Ruiz"]);
  });

  it("si Google revocó el acceso, pide reconectar y olvida la conexión", async () => {
    const t = await newTeacher();
    const google = fakeGoogle({ refreshFails: true });
    await connect(t.cookie, google);
    resetClassroomCache();
    const r = await call("GET", "/api/classroom/courses", { cookie: t.cookie });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Volvé a conectarla/);
    expect((await call("GET", "/api/classroom/status", { cookie: t.cookie })).body.connected).toBe(false);
  });
});

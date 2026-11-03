// Google Classroom for a workspace: the connection (refresh token, encrypted), and the calls the app
// makes on the teacher's behalf: list courses and students, post an activity as an assignment (or as
// a material, «Consigna», with no grade) and grade its submissions. Google only lets an app grade assignments that app created, so grades go
// to activities published from here.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { env } from "../env";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import { HttpError, notFound } from "../lib/errors";
import { log } from "../lib/logger";
import { CLASSROOM_SCOPES, TOKEN_URL, googleFetch, type GoogleTokens } from "../auth/google";
import type { ClassroomCourse, ClassroomKind, ClassroomLink, ClassroomRosterStudent, ClassroomStatus } from "@shared/contracts/classroom";

const API = "https://classroom.googleapis.com/v1";
const keyMaterial = () => env.TOKEN_ENCRYPTION_KEY || env.GOOGLE_CLIENT_SECRET;

const expired = () => new HttpError(409, "Tu conexión con Google Classroom venció. Volvé a conectarla.", "classroom_reconnect");
const notConnected = () => new HttpError(409, "Primero conectá tu cuenta de Google Classroom.", "classroom_not_connected");

// ───────────── Connection ─────────────

export async function saveConnection(teacherId: string, t: GoogleTokens) {
  const [prev] = await db.select().from(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
  // Google sends a refresh token only on the first consent: a reconnection may keep the stored one.
  const refresh = t.refreshToken ? encryptSecret(t.refreshToken, keyMaterial()) : prev?.refreshToken;
  if (!refresh) throw expired();
  const values = { googleSub: t.profile.sub, googleEmail: t.profile.email, refreshToken: refresh, scopes: t.scope };
  await db
    .insert(schema.classroomConnections)
    .values({ teacherId, ...values })
    .onConflictDoUpdate({ target: schema.classroomConnections.teacherId, set: { ...values, updatedAt: new Date() } });
  if (t.accessToken) accessCache.set(teacherId, { token: t.accessToken, exp: Date.now() + (t.expiresIn - 60) * 1000 });
}

export async function classroomStatus(teacherId: string, available: boolean): Promise<ClassroomStatus> {
  const [row] = await db.select().from(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
  if (!row) return { available, connected: false, email: null, missingScopes: false };
  const granted = row.scopes.split(/\s+/);
  return { available, connected: true, email: row.googleEmail, missingScopes: CLASSROOM_SCOPES.some((s) => !granted.includes(s)) };
}

export async function disconnect(teacherId: string) {
  const [row] = await db.select().from(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
  if (!row) return;
  const token = decryptSecret(row.refreshToken, keyMaterial());
  // Revoking is a courtesy: the connection is removed here either way.
  if (token) {
    await googleFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
  }
  await db.delete(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
  accessCache.delete(teacherId);
}

// ───────────── Access tokens ─────────────

const accessCache = new Map<string, { token: string; exp: number }>();

/** Tests start from an empty database. */
export function resetClassroomCache() {
  accessCache.clear();
}

async function accessToken(teacherId: string): Promise<string> {
  const hit = accessCache.get(teacherId);
  if (hit && hit.exp > Date.now()) return hit.token;
  const [row] = await db.select().from(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
  if (!row) throw notConnected();
  const refresh = decryptSecret(row.refreshToken, keyMaterial());
  if (!refresh) throw expired();
  const res = await googleFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }).toString(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) throw new HttpError(503, "No pudimos hablar con Google. Probá de nuevo en un momento.", "classroom_unavailable");
  if (!res.ok) {
    // The teacher revoked the access (or the token expired): it has to be connected again.
    if (res.status === 400 || res.status === 401) {
      await db.delete(schema.classroomConnections).where(eq(schema.classroomConnections.teacherId, teacherId));
      throw expired();
    }
    throw new HttpError(503, "No pudimos hablar con Google. Probá de nuevo en un momento.", "classroom_unavailable");
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw expired();
  accessCache.set(teacherId, { token: body.access_token, exp: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 });
  return body.access_token;
}

// ───────────── Classroom API ─────────────

async function call<T>(teacherId: string, method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken(teacherId);
  const res = await googleFetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) throw new HttpError(503, "Google Classroom no respondió. Probá de nuevo en un momento.", "classroom_unavailable");
  if (res.ok) return (res.status === 204 ? {} : await res.json()) as T;
  const text = await res.text().catch(() => "");
  log.warn("classroom_api_error", { status: res.status, path: path.replace(/\/[\w-]{6,}/g, "/:id"), reason: text.slice(0, 200) });
  if (res.status === 401) {
    accessCache.delete(teacherId);
    throw expired();
  }
  if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
    throw new HttpError(503, "La conexión con Classroom todavía no está habilitada en Google para esta app. Avisale al equipo.", "classroom_api_disabled");
  }
  if (res.status === 403 && /insufficient|scope/i.test(text)) {
    throw new HttpError(409, "Google no nos dio todos los permisos de Classroom. Volvé a conectar y dejá tildadas todas las opciones.", "classroom_reconnect");
  }
  if (res.status === 403 && /ProjectPermissionDenied|developer/i.test(text)) {
    throw new HttpError(403, "Classroom solo deja poner notas en tareas creadas desde Aula Socrática.", "classroom_forbidden");
  }
  if (res.status === 403) throw new HttpError(403, "Classroom no te deja hacer esto en ese curso. ¿Sos docente del curso?", "classroom_forbidden");
  if (res.status === 404) throw new HttpError(404, "No encontramos eso en Classroom: puede que se haya borrado o archivado.", "classroom_not_found");
  if (res.status === 429) throw new HttpError(429, "Classroom está recibiendo muchos pedidos. Esperá un minuto y probá de nuevo.", "classroom_busy");
  throw new HttpError(503, "Google Classroom tuvo un problema. Probá de nuevo en un momento.", "classroom_unavailable");
}

/** Every page of a list (Classroom pages at 100 or so). */
async function all<T>(teacherId: string, path: string, key: string, cap = 1000): Promise<T[]> {
  const out: T[] = [];
  let page = "";
  do {
    const sep = path.includes("?") ? "&" : "?";
    const r = await call<Record<string, unknown>>(teacherId, "GET", `${path}${sep}pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...((r[key] as T[] | undefined) ?? []));
    page = typeof r.nextPageToken === "string" ? r.nextPageToken : "";
  } while (page && out.length < cap);
  return out;
}

export async function listCourses(teacherId: string): Promise<ClassroomCourse[]> {
  const rows = await all<{ id: string; name?: string; section?: string; alternateLink?: string }>(teacherId, "/courses?teacherId=me&courseStates=ACTIVE", "courses");
  return rows.map((c) => ({ id: c.id, name: c.name ?? "Curso sin nombre", section: c.section ?? "", url: c.alternateLink ?? "" }));
}

export async function roster(teacherId: string, courseId: string): Promise<ClassroomRosterStudent[]> {
  const rows = await all<{ userId: string; profile?: { name?: { fullName?: string } } }>(teacherId, `/courses/${encodeURIComponent(courseId)}/students`, "students");
  return rows
    .map((s) => ({ userId: s.userId, name: s.profile?.name?.fullName?.trim() || "Alumno sin nombre" }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function publishCoursework(
  teacherId: string,
  input: { kind: ClassroomKind; courseId: string; title: string; description: string; url: string; maxPoints: number | null; dueDate: string | null },
): Promise<{ courseworkId: string; url: string; courseName: string }> {
  const courses = await listCourses(teacherId);
  const course = courses.find((c) => c.id === input.courseId);
  if (!course) throw new HttpError(404, "No encontramos ese curso entre tus cursos activos de Classroom.", "classroom_not_found");
  const common = {
    title: input.title.slice(0, 3000),
    description: input.description.slice(0, 30_000),
    materials: [{ link: { url: input.url, title: input.title.slice(0, 200) } }],
    state: "PUBLISHED",
  };
  const base = `/courses/${encodeURIComponent(input.courseId)}`;
  const due = input.dueDate ? input.dueDate.split("-").map(Number) : null;
  const created =
    input.kind === "material"
      ? await call<{ id: string; alternateLink?: string }>(teacherId, "POST", `${base}/courseWorkMaterials`, common)
      : await call<{ id: string; alternateLink?: string }>(teacherId, "POST", `${base}/courseWork`, {
          ...common,
          workType: "ASSIGNMENT",
          maxPoints: input.maxPoints,
          // Classroom takes the due time in UTC: 23:59 in Argentina is 02:59 of the next day.
          ...(due ? { dueDate: nextDay(due), dueTime: { hours: 2, minutes: 59 } } : {}),
        });
  return { courseworkId: created.id, url: created.alternateLink ?? course.url, courseName: course.section ? `${course.name} · ${course.section}` : course.name };
}

function nextDay([y, m, d]: number[]): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

interface Submission {
  id: string;
  userId: string;
  state?: string;
}

export async function submissions(teacherId: string, link: { courseId: string; courseworkId: string }): Promise<Submission[]> {
  return all<Submission>(
    teacherId,
    `/courses/${encodeURIComponent(link.courseId)}/courseWork/${encodeURIComponent(link.courseworkId)}/studentSubmissions`,
    "studentSubmissions",
  );
}

/** Sets the grade (draft and assigned) and, if asked, returns the work so the student sees it. */
export async function gradeSubmission(teacherId: string, link: { courseId: string; courseworkId: string }, submissionId: string, grade: number, giveBack: boolean) {
  const base = `/courses/${encodeURIComponent(link.courseId)}/courseWork/${encodeURIComponent(link.courseworkId)}/studentSubmissions/${encodeURIComponent(submissionId)}`;
  await call(teacherId, "PATCH", `${base}?updateMask=draftGrade,assignedGrade`, { draftGrade: grade, assignedGrade: grade });
  if (giveBack) await call(teacherId, "POST", `${base}:return`, {});
}

// ───────────── Links kept in the app ─────────────

export async function courseworkOf(activityId: string): Promise<ClassroomLink | null> {
  const [row] = await db.select().from(schema.classroomCourseworks).where(eq(schema.classroomCourseworks.activityId, activityId));
  return row
    ? {
        kind: row.kind,
        courseId: row.courseId,
        courseName: row.courseName,
        courseworkId: row.courseworkId,
        url: row.url,
        maxPoints: row.maxPoints,
        createdAt: row.createdAt.toISOString(),
      }
    : null;
}

export async function rememberMatches(courseId: string, pairs: { studentId: string; userId: string }[]) {
  for (const p of pairs) {
    await db
      .insert(schema.classroomStudentLinks)
      .values({ studentId: p.studentId, courseId, googleUserId: p.userId })
      .onConflictDoUpdate({
        target: [schema.classroomStudentLinks.studentId, schema.classroomStudentLinks.courseId],
        set: { googleUserId: p.userId, updatedAt: new Date() },
      });
  }
}

export async function rememberedMatches(courseId: string, studentIds: string[]): Promise<Map<string, string>> {
  if (!studentIds.length) return new Map();
  const rows = await db
    .select()
    .from(schema.classroomStudentLinks)
    .where(and(eq(schema.classroomStudentLinks.courseId, courseId), inArray(schema.classroomStudentLinks.studentId, studentIds)));
  return new Map(rows.map((r) => [r.studentId, r.googleUserId]));
}

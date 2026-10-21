// Student identity and device sessions. Students have no account: they type their name on
// the activity link; the name is matched inside the activity's classroom (nameKey) and the
// device gets a random token (stored hashed) in an httpOnly cookie scoped to the activity.
// A name that already has work in the activity can only be continued on a new device with
// its resume code. Availability (link on, dates, published, classroom not archived) is
// checked on EVERY request through loadStudentContext / ensureAvailable.
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { HttpError, badRequest } from "../../lib/errors";
import { humanCode, normalizeCode, randomToken, safeEqual, sha256 } from "../../lib/crypto";
import { hit } from "../../lib/rate-limit";
import { clientIp } from "../../lib/request";
import { publish } from "../../lib/events";
import { secureCookies } from "../../env";
import { LINK_AVAILABILITY_MESSAGE, linkAvailability, type LinkAvailability } from "@shared/domain/access-rules";
import { validateStudentName } from "@shared/domain/names";
import { readReflection, sanitizeReflectionQuestions, type ReflectionQuestion } from "@shared/domain/activity-design";
import { isVoiceLanguage } from "@shared/domain/voice";
import { classroomLabel } from "@shared/contracts/classrooms";
import type { StudentFile, StudentLinkInfo, StudentMessage, StudentStage, StudentWorkspace } from "@shared/contracts/student";
import type { FileKind } from "@shared/domain/files";
import { isStreaming } from "./streams";

const DAY = 86_400_000;
export const DEVICE_TOKEN_DAYS = 30;
/** Max participants per activity (self-registration through a public link). */
export const MAX_SESSIONS_PER_ACTIVITY = 400;

// Rate limits. A whole class usually shares one public IP (school NAT), so the per-IP
// limits are sized for ~40 students joining at once rather than for one person.
export const JOIN_LIMIT = { perIp: 60, windowMs: 10 * 60_000 };
export const CODE_LIMIT = { perIp: 30, windowMs: 10 * 60_000 };
export const WRONG_CODE_LIMIT = { perSession: 5, windowMs: 15 * 60_000 };

type Activity = typeof schema.activities.$inferSelect;
type Session = typeof schema.learningSessions.$inferSelect;
type Student = typeof schema.students.$inferSelect;

export interface LinkCtx {
  activity: Activity;
  classroom: { id: string; name: string; grade: string; division: string; school: string; isArchived: boolean };
  teacher: { displayName: string; isSuspended: boolean };
}

export interface StudentCtx extends LinkCtx {
  session: Session;
  student: Student;
}

const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{6,128}$/;

export function cookieName(activityId: string): string {
  return `as_s_${activityId.replace(/-/g, "")}`;
}

// The two lookups of every student request are prepared statements (built once by Drizzle,
// parsed once per connection by Postgres). Dates go as ISO strings.
const linkByToken = db
  .select({
    activity: schema.activities,
    classroom: {
      id: schema.classrooms.id,
      name: schema.classrooms.name,
      grade: schema.classrooms.grade,
      division: schema.classrooms.division,
      school: schema.classrooms.school,
      isArchived: schema.classrooms.isArchived,
    },
    teacher: { displayName: schema.teachers.displayName, isSuspended: schema.teachers.isSuspended },
  })
  .from(schema.activities)
  .innerJoin(schema.classrooms, eq(schema.classrooms.id, schema.activities.classroomId))
  .innerJoin(schema.teachers, eq(schema.teachers.id, schema.activities.teacherId))
  .where(eq(schema.activities.linkToken, sql.placeholder("token")))
  .limit(1)
  .prepare("student_link_by_token");

const sessionByDeviceToken = db
  .select({ session: schema.learningSessions, student: schema.students })
  .from(schema.studentTokens)
  .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, schema.studentTokens.sessionId))
  .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
  .where(
    and(
      eq(schema.studentTokens.tokenHash, sql.placeholder("tokenHash")),
      isNull(schema.studentTokens.revokedAt),
      gt(schema.studentTokens.expiresAt, sql`${sql.placeholder("now")}::timestamptz`),
      eq(schema.learningSessions.activityId, sql.placeholder("activityId")),
    ),
  )
  .limit(1)
  .prepare("student_session_by_device_token");

export async function loadLink(token: string): Promise<LinkCtx> {
  if (!LINK_TOKEN_RE.test(token)) throw linkNotFound();
  const [row] = await linkByToken.execute({ token });
  if (!row) throw linkNotFound();
  return row;
}

function linkNotFound() {
  return new HttpError(404, "No encontramos esta actividad. Revisá que el enlace esté completo o pedíselo a tu docente.", "not_found");
}

export function availabilityOf(link: LinkCtx): LinkAvailability {
  return linkAvailability(link.activity, { classroomArchived: link.classroom.isArchived || link.teacher.isSuspended });
}

export function ensureAvailable(link: LinkCtx): void {
  const av = availabilityOf(link);
  if (av !== "available") throw new HttpError(403, LINK_AVAILABILITY_MESSAGE[av], "unavailable", { availability: av });
}

// ── Device tokens ──

export async function deviceSession(c: Context, link: LinkCtx): Promise<StudentCtx | null> {
  const token = getCookie(c, cookieName(link.activity.id));
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await sessionByDeviceToken.execute({
    tokenHash: sha256(token),
    now: new Date().toISOString(),
    activityId: link.activity.id,
  });
  return row ? { ...link, ...row } : null;
}

/** Link + availability + this device's session, or the matching 404/403/401. */
export async function loadStudentContext(c: Context, token: string): Promise<StudentCtx> {
  const link = await loadLink(token);
  ensureAvailable(link);
  const ctx = await deviceSession(c, link);
  if (!ctx) {
    throw new HttpError(401, "Tu sesión en este dispositivo terminó. Volvé a entrar con tu nombre.", "no_session");
  }
  return ctx;
}

async function issueDeviceToken(c: Context, activityId: string, sessionId: string): Promise<void> {
  const name = cookieName(activityId);
  const previous = getCookie(c, name);
  if (previous) {
    await db
      .update(schema.studentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.studentTokens.tokenHash, sha256(previous)), isNull(schema.studentTokens.revokedAt)));
  }
  const token = randomToken();
  await db.insert(schema.studentTokens).values({
    sessionId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + DEVICE_TOKEN_DAYS * DAY),
  });
  setCookie(c, name, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Lax",
    path: "/api/s",
    maxAge: DEVICE_TOKEN_DAYS * 86_400,
  });
}

/** "No soy <nombre>": revokes this device's token (works even if the link is closed). */
export async function leaveDevice(c: Context, link: LinkCtx): Promise<void> {
  const name = cookieName(link.activity.id);
  const token = getCookie(c, name);
  if (token) {
    await db
      .update(schema.studentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.studentTokens.tokenHash, sha256(token)), isNull(schema.studentTokens.revokedAt)));
  }
  deleteCookie(c, name, { path: "/api/s", secure: secureCookies });
}

// ── Pedagogical events ──

export async function recordEvent(
  sessionId: string,
  eventType: string,
  details: Record<string, unknown> = {},
  messageId: string | null = null,
): Promise<void> {
  await db.insert(schema.pedagogicalEvents).values({ sessionId, eventType, details, messageId, source: "observed" });
}

// ── Join / resume ──

function nameOrThrow(raw: string) {
  const v = validateStudentName(raw);
  if (!v.ok) throw badRequest(v.error, { name: v.error });
  return v;
}

async function findStudent(classroomId: string, key: string) {
  const [s] = await db
    .select()
    .from(schema.students)
    .where(and(eq(schema.students.classroomId, classroomId), eq(schema.students.nameKey, key)))
    .limit(1);
  return s ?? null;
}

async function findSession(activityId: string, studentId: string) {
  const [s] = await db
    .select()
    .from(schema.learningSessions)
    .where(and(eq(schema.learningSessions.activityId, activityId), eq(schema.learningSessions.studentId, studentId)))
    .limit(1);
  return s ?? null;
}

function resumeRequired(name: string) {
  return new HttpError(
    409,
    `Ya hay un trabajo empezado como «${name}» en esta actividad. Para seguirlo en este dispositivo, escribí tu código.`,
    "resume_required",
  );
}

/**
 * Enters the activity with a name. New name → new student (self-registered) + session.
 * Name already on the roster without work → its session is created. Name with work →
 * 409 resume_required unless this device already holds that session.
 */
export async function joinWithName(c: Context, link: LinkCtx, rawName: string): Promise<{ ctx: StudentCtx; created: boolean }> {
  ensureAvailable(link);
  if (!hit(`s_join:${link.activity.id}:${clientIp(c)}`, JOIN_LIMIT.perIp, JOIN_LIMIT.windowMs)) {
    throw new HttpError(429, "Hubo demasiados ingresos desde esta conexión. Esperá unos minutos y probá de nuevo.", "rate_limited");
  }
  const v = nameOrThrow(rawName);
  let student = await findStudent(link.classroom.id, v.key);
  if (student) {
    const existing = await findSession(link.activity.id, student.id);
    if (existing) {
      const device = await deviceSession(c, link);
      if (device && device.session.id === existing.id) return { ctx: device, created: false };
      throw resumeRequired(student.fullName);
    }
  }

  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.learningSessions)
    .where(eq(schema.learningSessions.activityId, link.activity.id));
  if ((count?.n ?? 0) >= MAX_SESSIONS_PER_ACTIVITY) {
    throw new HttpError(409, "Esta actividad ya tiene el máximo de participantes. Avisale a tu docente.", "full");
  }

  if (!student) {
    await db
      .insert(schema.students)
      .values({ classroomId: link.classroom.id, fullName: v.name, nameKey: v.key, selfRegistered: true })
      .onConflictDoNothing();
    student = await findStudent(link.classroom.id, v.key);
    if (!student) throw new HttpError(500, "No pudimos registrar tu nombre. Probá de nuevo.", "join_failed");
  }

  const [created] = await db
    .insert(schema.learningSessions)
    .values({ activityId: link.activity.id, studentId: student.id, resumeCode: humanCode(6) })
    .onConflictDoNothing()
    .returning();
  // Lost a race with another device entering with the same name at the same time.
  if (!created) throw resumeRequired(student.fullName);

  await issueDeviceToken(c, link.activity.id, created.id);
  await recordEvent(created.id, "session_entered", { resumed: false });
  publish(link.activity.id, "session", created.id);
  const ctx = await sessionContext(link, created.id, student);
  return { ctx, created: true };
}

// Wrong resume codes per session (in memory, single instance like the rate limiter).
const wrongCodes = new Map<string, number[]>();

function recentWrong(sessionId: string, now = Date.now()): number[] {
  const list = (wrongCodes.get(sessionId) ?? []).filter((t) => t > now - WRONG_CODE_LIMIT.windowMs);
  if (list.length) wrongCodes.set(sessionId, list);
  else wrongCodes.delete(sessionId);
  return list;
}

setInterval(() => {
  for (const id of [...wrongCodes.keys()]) recentWrong(id);
}, 10 * 60_000).unref();

/** Continues an existing session on this device with the resume code. */
export async function resumeWithCode(c: Context, link: LinkCtx, rawName: string, rawCode: string): Promise<StudentCtx> {
  ensureAvailable(link);
  if (!hit(`s_code:${clientIp(c)}`, CODE_LIMIT.perIp, CODE_LIMIT.windowMs)) {
    throw new HttpError(429, "Hubo demasiados intentos desde esta conexión. Esperá unos minutos y probá de nuevo.", "rate_limited");
  }
  const v = nameOrThrow(rawName);
  const student = await findStudent(link.classroom.id, v.key);
  const session = student ? await findSession(link.activity.id, student.id) : null;
  if (!student || !session) {
    throw new HttpError(
      404,
      "No encontramos un trabajo con ese nombre en esta actividad. Revisá cómo lo escribiste o entrá como nuevo.",
      "not_found",
      { name: "No hay un trabajo con este nombre." },
    );
  }
  if (recentWrong(session.id).length >= WRONG_CODE_LIMIT.perSession) {
    throw new HttpError(
      429,
      "Se probaron demasiados códigos para este nombre. Esperá 15 minutos o pedile tu código a tu docente.",
      "locked",
    );
  }
  const code = normalizeCode(rawCode);
  if (!safeEqual(code, session.resumeCode)) {
    const list = recentWrong(session.id);
    list.push(Date.now());
    wrongCodes.set(session.id, list);
    const left = WRONG_CODE_LIMIT.perSession - list.length;
    const msg =
      left > 0
        ? `Ese código no coincide. Revisalo o pedíselo a tu docente (te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}).`
        : "Ese código no coincide. Se probaron demasiados códigos: esperá 15 minutos o pedile tu código a tu docente.";
    throw new HttpError(400, msg, "wrong_code", { code: "El código no coincide." });
  }
  wrongCodes.delete(session.id);
  await issueDeviceToken(c, link.activity.id, session.id);
  await recordEvent(session.id, "session_entered", { resumed: true });
  publish(link.activity.id, "session", session.id);
  return sessionContext(link, session.id, student);
}

async function sessionContext(link: LinkCtx, sessionId: string, student: Student): Promise<StudentCtx> {
  const [session] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, sessionId)).limit(1);
  if (!session) throw new HttpError(500, "No pudimos abrir tu trabajo. Probá de nuevo.", "join_failed");
  return { ...link, session, student };
}

/** Re-reads the session row (after an update). */
export async function refreshSession(ctx: StudentCtx): Promise<StudentCtx> {
  const [session] = await db.select().from(schema.learningSessions).where(eq(schema.learningSessions.id, ctx.session.id)).limit(1);
  return session ? { ...ctx, session } : ctx;
}

// ── Workspace payload ──

/**
 * The activity's reflection questions exactly as the teacher left them. New activities start
 * with DEFAULT_REFLECTION_QUESTIONS; an empty list is a deliberate choice (no reflection step).
 */
export function reflectionQuestionsOf(activity: Activity): ReflectionQuestion[] {
  return sanitizeReflectionQuestions(activity.reflectionQuestions);
}

export function stageOf(activity: Activity, session: Session): StudentStage {
  if (session.endedByTeacher) return "ended";
  if (session.status === "completed") return "completed";
  if (activity.requireInitialAnswer && !session.initialAnswer) return "initial";
  return "tutor";
}

export function isReadOnly(session: Session): boolean {
  return session.endedByTeacher || session.status === "completed";
}

export function readOnlyError(session: Session): HttpError {
  return new HttpError(
    409,
    session.endedByTeacher
      ? "Tu docente cerró tu sesión: ya no se pueden agregar respuestas."
      : "Ya terminaste esta actividad: tu trabajo quedó guardado.",
    "read_only",
  );
}

export function publicActivity(link: LinkCtx): StudentLinkInfo["activity"] {
  const av = availabilityOf(link);
  if (av === "unpublished" || av === "archived") return null;
  const a = link.activity;
  const room = classroomLabel(link.classroom);
  return {
    title: a.title,
    subject: a.subject,
    classroom: [room, link.classroom.school].filter(Boolean).join(" · "),
    teacherName: link.teacher.displayName,
  };
}

export async function buildWorkspace(ctx: StudentCtx): Promise<StudentWorkspace> {
  const { activity, session, student } = ctx;
  const [messages, files] = await Promise.all([
    db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, false)))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id)),
    db
      .select({
        id: schema.activityFiles.id,
        fileName: schema.activityFiles.fileName,
        kind: schema.activityFiles.kind,
        mimeType: schema.activityFiles.mimeType,
        sizeBytes: schema.activityFiles.sizeBytes,
      })
      .from(schema.activityFiles)
      .where(and(eq(schema.activityFiles.activityId, activity.id), eq(schema.activityFiles.processingStatus, "ready")))
      .orderBy(asc(schema.activityFiles.createdAt)),
  ]);
  const questions = reflectionQuestionsOf(activity);
  return {
    studentName: student.fullName,
    resumeCode: session.resumeCode,
    stage: stageOf(activity, session),
    session: {
      status: session.status === "completed" ? "completed" : "in_progress",
      endedByTeacher: session.endedByTeacher,
      initialAnswer: session.initialAnswer,
      finalAnswer: session.finalAnswer,
      reflection: readReflection(session.reflection, questions),
      hintCount: session.hintCount,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    },
    activity: {
      title: activity.title,
      subject: activity.subject,
      objectives: activity.objectives,
      instructions: activity.instructions,
      material: activity.material,
      requireInitialAnswer: activity.requireInitialAnswer,
      voiceLanguage: isVoiceLanguage(activity.voiceLanguage) ? activity.voiceLanguage : "off",
      reflectionQuestions: questions,
    },
    files: files.map(
      (f): StudentFile => ({
        id: f.id,
        name: f.fileName,
        kind: f.kind as FileKind,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        url: `/api/s/${encodeURIComponent(activity.linkToken)}/files/${f.id}`,
      }),
    ),
    messages: messages.map(
      (m): StudentMessage => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
        intent: m.intent,
        inputMode: m.inputMode === "voice" ? "voice" : "text",
        createdAt: m.createdAt.toISOString(),
      }),
    ),
    replyPending: isStreaming(session.id),
  };
}

// Student identity and device sessions. Students have no account: they type their name on
// the activity link; the name is matched inside the activity's classroom (nameKey) and the
// device gets a random token (stored hashed) in an httpOnly cookie scoped to the activity.
// A name that already has work in the activity can only be continued on a new device with
// its resume code. Availability (link on, dates, published, classroom not archived) is
// checked on EVERY request through loadStudentContext / ensureAvailable. The one exception is
// reading: a device whose work is already finished keeps seeing it (read-only) after the
// teacher closes the link.
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
import { isDeliverableMode, type DeliverableKind } from "@shared/domain/deliverables";
import {
  normalizeResumeCode,
  studentMetaLine,
  type StudentFile,
  type StudentLinkInfo,
  type StudentMessage,
  type StudentStage,
  type StudentWorkspace,
} from "@shared/contracts/student";
import type { FileKind } from "@shared/domain/files";
import { isStreaming } from "./streams";

const DAY = 86_400_000;
export const DEVICE_TOKEN_DAYS = 30;
/** Max participants per activity (self-registration through a public link). */
export const MAX_SESSIONS_PER_ACTIVITY = 400;

// Rate limits. A whole class usually shares one public IP (school NAT), so the per-IP
// limits are sized for ~40 students joining at once rather than for one person.
export const JOIN_LIMIT = { perIp: 60, windowMs: 10 * 60_000 };
/** Resume requests per connection (flood guard; a whole class switching devices fits). */
export const CODE_LIMIT = { perIp: 120, windowMs: 10 * 60_000 };
/**
 * Wrong resume codes. The lockout is per name AND connection, so a classmate who knows a name
 * cannot lock the real student out from another connection; a cap per name across all
 * connections keeps guessing hopeless anyway (32^6 ≈ 1e9 codes, at most `perName` tries per
 * window, and reaching it needs ≥ perName / perConnection different networks: ≈ 1000 years to
 * try them all).
 */
export const WRONG_CODE_LIMIT = { perConnection: 5, perName: 30, perConnectionAllNames: 30, windowMs: 15 * 60_000 };

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
  // Also what an old link answers after the teacher generated a new one (old tokens are not kept).
  return new HttpError(
    404,
    "No encontramos esta actividad. Revisá que el enlace esté completo; si lo está, puede que tu docente lo haya cambiado por uno nuevo: pedíselo.",
    "not_found",
  );
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
    `Ya hay un trabajo empezado como «${name}» en esta actividad. Si sos vos, escribí tu código para seguirlo en este dispositivo. ` +
      "Si no empezaste vos, avisale a tu docente: puede darte tu código o borrar ese ingreso para que entres.",
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
  // fromRoster: the name was on the teacher's list (helps spot someone entering as a classmate).
  await recordEvent(created.id, "session_entered", { resumed: false, fromRoster: !student.selfRegistered });
  publish(link.activity.id, "session", created.id);
  const ctx = await sessionContext(link, created.id, student);
  return { ctx, created: true };
}

// Wrong resume codes (in memory, single instance like the rate limiter). Keys: per name
// ("target"), per name + connection, and per connection across all names.
const wrongCodes = new Map<string, number[]>();

function recentWrong(key: string, now = Date.now()): number[] {
  const list = (wrongCodes.get(key) ?? []).filter((t) => t > now - WRONG_CODE_LIMIT.windowMs);
  if (list.length) wrongCodes.set(key, list);
  else wrongCodes.delete(key);
  return list;
}

function addWrong(key: string, now = Date.now()): number {
  const list = recentWrong(key, now);
  list.push(now);
  wrongCodes.set(key, list);
  return list.length;
}

setInterval(() => {
  for (const id of [...wrongCodes.keys()]) recentWrong(id);
}, 10 * 60_000).unref();

/**
 * The connection a request comes from, for the per-connection lockout. IPv6 clients usually
 * own a whole /64, so those addresses count as one connection.
 */
export function connectionKey(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!ip.includes(":")) return ip;
  const lower = ip.toLowerCase().split("%")[0]!;
  const [head = "", tail = ""] = lower.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = lower.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

const LOCKED_MESSAGE =
  "Probaste demasiados códigos para este nombre. Esperá 15 minutos y volvé a intentar con el código que te dé tu docente.";

/**
 * Continues an existing session on this device with the resume code. An unknown name and a
 * wrong code get the same answer (and the same countdown), so the endpoint never tells who
 * already started the activity. A malformed code never gets here (resumeBody rejects it
 * without counting an attempt).
 */
export async function resumeWithCode(c: Context, link: LinkCtx, rawName: string, rawCode: string): Promise<StudentCtx> {
  ensureAvailable(link);
  const ip = clientIp(c);
  if (!hit(`s_code:${ip}`, CODE_LIMIT.perIp, CODE_LIMIT.windowMs)) {
    throw new HttpError(429, "Hubo demasiados intentos desde esta conexión. Esperá unos minutos y probá de nuevo.", "rate_limited");
  }
  // Only WRONG codes count against the connection, so a class resuming at once is never stopped.
  const connection = `ip:${connectionKey(ip)}`;
  if (recentWrong(connection).length >= WRONG_CODE_LIMIT.perConnectionAllNames) {
    throw new HttpError(429, "Hubo demasiados intentos desde esta conexión. Esperá unos minutos y probá de nuevo.", "rate_limited");
  }
  const v = nameOrThrow(rawName);
  const found = await findWorkByName(link, v.key);
  // Names without work get counters too, so both cases behave identically.
  const target = found ? `s:${found.session.id}` : `n:${link.activity.id}:${v.key}`;
  const perConnection = `${target}@${connectionKey(ip)}`;
  if (
    recentWrong(perConnection).length >= WRONG_CODE_LIMIT.perConnection ||
    recentWrong(target).length >= WRONG_CODE_LIMIT.perName
  ) {
    throw new HttpError(429, LOCKED_MESSAGE, "locked");
  }
  const code = normalizeResumeCode(rawCode);
  if (!found || !safeEqual(code, found.session.resumeCode)) {
    const used = addWrong(perConnection);
    addWrong(target);
    addWrong(connection);
    const left = WRONG_CODE_LIMIT.perConnection - used;
    const msg =
      left > 0
        ? "Ese nombre y ese código no coinciden con ningún trabajo de esta actividad. Revisá los dos o pedile tu código a tu docente " +
          `(te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}).`
        : `Ese nombre y ese código no coinciden. ${LOCKED_MESSAGE}`;
    throw new HttpError(400, msg, "wrong_code");
  }
  const { session, student } = found;
  // The right code proves it is the student: start again from zero everywhere.
  wrongCodes.delete(perConnection);
  wrongCodes.delete(target);
  await issueDeviceToken(c, link.activity.id, session.id);
  await recordEvent(session.id, "session_entered", { resumed: true });
  publish(link.activity.id, "session", session.id);
  return sessionContext(link, session.id, student);
}

/** The session of this name in the activity, in ONE query whether or not the name exists. */
async function findWorkByName(link: LinkCtx, key: string): Promise<{ session: Session; student: Student } | null> {
  const [row] = await db
    .select({ session: schema.learningSessions, student: schema.students })
    .from(schema.learningSessions)
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .where(
      and(
        eq(schema.learningSessions.activityId, link.activity.id),
        eq(schema.students.classroomId, link.classroom.id),
        eq(schema.students.nameKey, key),
      ),
    )
    .limit(1);
  return row ?? null;
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
  const room = link.classroom;
  return {
    title: a.title,
    subject: a.subject,
    // Name, grade + division and school without repeating what the name already says.
    classroom: studentMetaLine([room.name, [room.grade, room.division].filter(Boolean).join(" "), room.school]),
    teacherName: link.teacher.displayName,
  };
}

/** Closed links (not archived/unpublished) still show a finished work to its own device. */
const READABLE_WHEN_CLOSED: LinkAvailability[] = ["inactive", "not_started", "expired"];

/**
 * This device's work for GET /:token: always while the link is available; once it is closed,
 * only if the work is already finished (read-only, without files, which need an open link).
 */
export async function linkWorkspace(c: Context, link: LinkCtx, availability: LinkAvailability): Promise<StudentWorkspace | null> {
  if (availability !== "available" && !READABLE_WHEN_CLOSED.includes(availability)) return null;
  const ctx = await deviceSession(c, link);
  if (!ctx) return null;
  if (availability === "available") return buildWorkspace(ctx);
  return isReadOnly(ctx.session) ? buildWorkspace(ctx, { files: false }) : null;
}

export async function buildWorkspace(ctx: StudentCtx, opts: { files?: boolean } = {}): Promise<StudentWorkspace> {
  const { activity, session, student } = ctx;
  const withFiles = opts.files ?? true;
  const [messages, files, deliverables] = await Promise.all([
    db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, false)))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id)),
    withFiles
      ? db
          .select({
            id: schema.activityFiles.id,
            fileName: schema.activityFiles.fileName,
            kind: schema.activityFiles.kind,
            mimeType: schema.activityFiles.mimeType,
            sizeBytes: schema.activityFiles.sizeBytes,
          })
          .from(schema.activityFiles)
          .where(and(eq(schema.activityFiles.activityId, activity.id), eq(schema.activityFiles.processingStatus, "ready")))
          .orderBy(asc(schema.activityFiles.createdAt))
      : Promise.resolve([]),
    db
      .select({
        fileName: schema.sessionDeliverables.fileName,
        kind: schema.sessionDeliverables.kind,
        url: schema.sessionDeliverables.url,
        sizeBytes: schema.sessionDeliverables.sizeBytes,
        updatedAt: schema.sessionDeliverables.updatedAt,
      })
      .from(schema.sessionDeliverables)
      .where(eq(schema.sessionDeliverables.sessionId, session.id))
      .limit(1),
  ]);
  const deliverable = deliverables[0];
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
      deliverableMode: isDeliverableMode(activity.deliverableMode) ? activity.deliverableMode : "off",
      deliverablePrompt: activity.deliverablePrompt,
    },
    deliverable: deliverable
      ? {
          name: deliverable.fileName,
          kind: deliverable.kind as DeliverableKind,
          sizeBytes: deliverable.sizeBytes,
          uploadedAt: deliverable.updatedAt.toISOString(),
          url:
            deliverable.kind === "link" && deliverable.url
              ? deliverable.url
              : `/api/s/${encodeURIComponent(activity.linkToken)}/deliverable/file`,
        }
      : null,
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

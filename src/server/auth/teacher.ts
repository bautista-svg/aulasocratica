// Teacher workspaces: an anonymous workspace is created with one click and lives in an
// httpOnly cookie; adding an email + password lets the teacher open it on other devices.
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { randomToken, sha256 } from "../lib/crypto";
import { HttpError } from "../lib/errors";
import { secureCookies } from "../env";
import { userAgent } from "../lib/request";
import type { AppEnv } from "../types";

export const TEACHER_COOKIE = "as_t";
const SESSION_DAYS = 365;
const DAY = 86_400_000;

export interface TeacherCtx {
  id: string;
  displayName: string;
  email: string | null;
  hasAccount: boolean;
  sessionId: string;
}

export async function createTeacherSession(c: Context, teacherId: string): Promise<void> {
  const token = randomToken();
  await db.insert(schema.teacherSessions).values({
    teacherId,
    tokenHash: sha256(token),
    userAgent: userAgent(c),
    expiresAt: new Date(Date.now() + SESSION_DAYS * DAY),
  });
  setCookie(c, TEACHER_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearTeacherCookie(c: Context) {
  deleteCookie(c, TEACHER_COOKIE, { path: "/", secure: secureCookies });
}

/** Loads the teacher from the session cookie when present (does not require it). */
export const loadTeacher: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, TEACHER_COOKIE);
  if (token && token.length >= 20 && token.length <= 100) {
    const rows = await db
      .select({
        sessionId: schema.teacherSessions.id,
        lastUsedAt: schema.teacherSessions.lastUsedAt,
        teacherId: schema.teachers.id,
        displayName: schema.teachers.displayName,
        email: schema.teachers.email,
        passwordHash: schema.teachers.passwordHash,
        isSuspended: schema.teachers.isSuspended,
        lastSeenAt: schema.teachers.lastSeenAt,
      })
      .from(schema.teacherSessions)
      .innerJoin(schema.teachers, eq(schema.teachers.id, schema.teacherSessions.teacherId))
      .where(and(eq(schema.teacherSessions.tokenHash, sha256(token)), gt(schema.teacherSessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (row && !row.isSuspended) {
      c.set("teacher", {
        id: row.teacherId,
        displayName: row.displayName,
        email: row.email,
        hasAccount: Boolean(row.email && row.passwordHash),
        sessionId: row.sessionId,
      });
      const now = Date.now();
      // Sliding expiry and "last seen", written at most once per hour.
      if (now - row.lastUsedAt.getTime() > 60 * 60_000) {
        await db
          .update(schema.teacherSessions)
          .set({ lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_DAYS * DAY) })
          .where(eq(schema.teacherSessions.id, row.sessionId));
      }
      if (now - row.lastSeenAt.getTime() > 60 * 60_000) {
        await db.update(schema.teachers).set({ lastSeenAt: new Date(now) }).where(eq(schema.teachers.id, row.teacherId));
      }
    } else if (row?.isSuspended) {
      throw new HttpError(403, "Este espacio fue suspendido por el administrador del sitio.", "suspended");
    }
  }
  await next();
};

/** Route guard: 401 when there is no workspace on this device. */
export const requireTeacher: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("teacher")) throw new HttpError(401, "No encontramos tu espacio en este dispositivo.", "no_session");
  await next();
};

export function teacherOf(c: Context<AppEnv>): TeacherCtx {
  const t = c.get("teacher");
  if (!t) throw new HttpError(401, "No encontramos tu espacio en este dispositivo.", "no_session");
  return t;
}

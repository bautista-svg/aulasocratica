// Platform-owner access to /admin. One password from the environment (ADMIN_PASSWORD; empty
// = panel disabled). A successful sign-in sets `as_admin`: an HMAC-signed token that expires
// after 8 hours, signed with a key derived from the password (changing the password signs
// everyone out). Failed attempts are recorded in audit_logs and lock the IP for 15 minutes.
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { and, eq, gt, sql } from "drizzle-orm";
import { env, secureCookies } from "../../env";
import { db, schema } from "../../db/client";
import { HttpError } from "../../lib/errors";

export const ADMIN_COOKIE = "as_admin";
const COOKIE_PATH = "/api/admin";
export const ADMIN_SESSION_MS = 8 * 60 * 60_000;
export const ADMIN_MAX_FAILURES = 5;
export const ADMIN_FAILURE_WINDOW_MS = 15 * 60_000;
/** Across all IPs: slows down a distributed guessing attack (it can lock the owner out for 15 min). */
export const ADMIN_MAX_GLOBAL_FAILURES = 30;
export const ADMIN_FAILED_ACTION = "admin_login_failed";

export const adminEnabled = () => env.ADMIN_PASSWORD.length > 0;

/** The panel does not exist when no password is configured. */
export function ensureAdminEnabled() {
  if (!adminEnabled()) throw new HttpError(404, "Ruta inexistente.", "not_found");
}

/** Constant-time comparison (both sides hashed to the same length first). */
export function adminPasswordMatches(input: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(env.ADMIN_PASSWORD, "utf8").digest();
  return timingSafeEqual(a, b);
}

function signingKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.ADMIN_PASSWORD, "aula-socratica/admin", "session-v1", 32));
}

const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");

// Signed-out tokens (single instance, see docs/ARQUITECTURA.md). Cleared as they expire.
const revoked = new Map<string, number>();

export function issueAdminToken(now = Date.now()): string {
  const payload = `v1.${now + ADMIN_SESSION_MS}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string | undefined, now = Date.now()): { nonce: string; exp: number } | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, expRaw, nonce, sig] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`v1.${expRaw}.${nonce}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now) return null;
  for (const [k, until] of revoked) if (until <= now) revoked.delete(k);
  if (revoked.has(nonce)) return null;
  return { nonce, exp };
}

export function setAdminCookie(c: Context, token: string) {
  setCookie(c, ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "Strict",
    path: COOKIE_PATH,
    maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  });
}

export function clearAdminCookie(c: Context) {
  const session = verifyAdminToken(getCookie(c, ADMIN_COOKIE));
  if (session) revoked.set(session.nonce, session.exp);
  deleteCookie(c, ADMIN_COOKIE, { path: COOKIE_PATH, secure: secureCookies });
}

export function hasAdminSession(c: Context): boolean {
  return verifyAdminToken(getCookie(c, ADMIN_COOKIE)) !== null;
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  ensureAdminEnabled();
  if (!hasAdminSession(c)) {
    throw new HttpError(401, "Tu sesión de administración venció o no existe. Ingresá de nuevo.", "admin_required");
  }
  await next();
};

/** Failed sign-ins in the last 15 minutes: from this IP and from everywhere. */
export async function recentAdminFailures(ip: string): Promise<{ ip: number; all: number }> {
  const since = new Date(Date.now() - ADMIN_FAILURE_WINDOW_MS);
  const [row] = await db
    .select({
      ip: sql<number>`count(*) filter (where ${schema.auditLogs.ip} = ${ip})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.action, ADMIN_FAILED_ACTION), gt(schema.auditLogs.createdAt, since)));
  return { ip: row?.ip ?? 0, all: row?.all ?? 0 };
}

export function isAdminLockedOut(f: { ip: number; all: number }): boolean {
  return f.ip >= ADMIN_MAX_FAILURES || f.all >= ADMIN_MAX_GLOBAL_FAILURES;
}

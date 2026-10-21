// /api/admin — the platform owner's read-only oversight plus abuse control (suspend a
// workspace). Disabled (404) when ADMIN_PASSWORD is empty. No student names or content.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { HttpError, notFound, readJson } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { clientIp } from "../lib/request";
import { audit } from "../services/audit";
import { isUuid } from "../services/access";
import {
  ADMIN_FAILED_ACTION,
  adminPasswordMatches,
  clearAdminCookie,
  ensureAdminEnabled,
  hasAdminSession,
  isAdminLockedOut,
  issueAdminToken,
  recentAdminFailures,
  requireAdmin,
  setAdminCookie,
} from "../services/admin/session";
import { adminOverview, adminWorkspaces } from "../services/admin/stats";
import { adminLoginBody } from "@shared/contracts/admin";

async function setSuspended(c: Parameters<typeof audit>[0], id: string, suspended: boolean) {
  if (!isUuid(id)) throw notFound("El espacio");
  const [row] = await db
    .update(schema.teachers)
    .set({ isSuspended: suspended })
    .where(eq(schema.teachers.id, id))
    .returning({ id: schema.teachers.id, isSuspended: schema.teachers.isSuspended });
  if (!row) throw notFound("El espacio");
  await audit(c, row.id, suspended ? "workspace_suspended" : "workspace_unsuspended", "teacher", row.id, { by: "admin" });
  return row;
}

export const adminRoutes = new Hono<AppEnv>()
  .use("*", async (_c, next) => {
    ensureAdminEnabled();
    await next();
  })

  .get("/session", (c) => c.json({ authenticated: hasAdminSession(c) }))

  // The lockout is keyed on clientIp(), which only trusts proxy headers when TRUST_PROXY=true:
  // rotating X-Forwarded-For does not buy more attempts.
  .post("/login", rateLimit("admin-login", 20, 15 * 60_000), async (c) => {
    const body = await readJson(c, adminLoginBody);
    const failures = await recentAdminFailures(clientIp(c));
    if (isAdminLockedOut(failures)) {
      c.header("Retry-After", "900");
      throw new HttpError(429, "Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.", "locked");
    }
    if (!adminPasswordMatches(body.password)) {
      await audit(c, null, ADMIN_FAILED_ACTION, "admin");
      throw new HttpError(401, "La contraseña no es correcta.", "bad_credentials", { password: "No coincide." });
    }
    await audit(c, null, "admin_login", "admin");
    setAdminCookie(c, issueAdminToken());
    return c.json({ ok: true });
  })

  .post("/logout", (c) => {
    clearAdminCookie(c);
    return c.json({ ok: true });
  })

  .get("/overview", requireAdmin, async (c) => c.json(await adminOverview()))

  .get("/workspaces", requireAdmin, async (c) => c.json(await adminWorkspaces(c.req.query("cursor"))))

  .post("/workspaces/:id/suspend", requireAdmin, async (c) => {
    const row = await setSuspended(c, c.req.param("id"), true);
    return c.json({ ok: true, suspended: row.isSuspended });
  })

  .post("/workspaces/:id/unsuspend", requireAdmin, async (c) => {
    const row = await setSuspended(c, c.req.param("id"), false);
    return c.json({ ok: true, suspended: row.isSuspended });
  });

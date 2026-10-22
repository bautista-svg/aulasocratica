import { Hono } from "hono";
import { and, eq, ne, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { readJson, badRequest, conflict, HttpError } from "../lib/errors";
import { hashPassword, verifyPassword, humanCode, normalizeCode, randomToken, sha256 } from "../lib/crypto";
import { rateLimit, hit } from "../lib/rate-limit";
import { clientIp } from "../lib/request";
import { createTeacherSession, clearTeacherCookie, requireTeacher, teacherOf } from "../auth/teacher";
import { toMe, getTeacher, workspaceHasContent, mergeWorkspaces, deleteWorkspace } from "../services/workspace";
import { audit } from "../services/audit";
import {
  startWorkspaceBody,
  updateMeBody,
  newsSeenBody,
  registerBody,
  loginBody,
  recoverBody,
  changePasswordBody,
  deleteWorkspaceBody,
} from "@shared/contracts/auth";

const newRecoveryCode = () => {
  const raw = humanCode(16);
  return { display: raw.match(/.{4}/g)!.join("-"), hash: sha256(raw) };
};

let decoy: Promise<string> | null = null;
/** A real scrypt hash of a random secret, computed once, to verify against when the email is unknown. */
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomToken(32));
  return decoy;
}

export const authRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const t = c.get("teacher");
    if (!t) return c.json({ teacher: null });
    const row = await getTeacher(t.id);
    return c.json({ teacher: row ? toMe(row) : null });
  })

  // One click, no data required: creates a workspace bound to this device.
  // Also accepts a plain HTML form post (the prerendered landing works before JS loads).
  .post("/start", rateLimit("start", 20, 60 * 60_000), async (c) => {
    const isForm = (c.req.header("content-type") ?? "").includes("application/x-www-form-urlencoded");
    const body = isForm ? {} : await readJson(c, startWorkspaceBody);
    const current = c.get("teacher");
    if (current) {
      if (isForm) return c.redirect("/app", 303);
      const row = await getTeacher(current.id);
      return c.json({ teacher: toMe(row!) });
    }
    // Service-wide cap on new anonymous workspaces (each one has its own AI budget).
    if (!hit("start-global", 300, 60 * 60_000)) {
      throw new HttpError(429, "Se están creando demasiados espacios en este momento. Probá de nuevo en unos minutos.", "rate_limited");
    }
    const [row] = await db.insert(schema.teachers).values({ displayName: body.displayName ?? "" }).returning();
    await createTeacherSession(c, row!.id);
    await audit(c, row!.id, "workspace_created", "teacher", row!.id);
    if (isForm) return c.redirect("/app", 303);
    return c.json({ teacher: toMe(row!) }, 201);
  })

  // The "Novedades" notice was shown: it never appears again, on any device.
  .post("/me/news", requireTeacher, async (c) => {
    const body = await readJson(c, newsSeenBody);
    const [row] = await db.update(schema.teachers).set({ newsSeen: body.id }).where(eq(schema.teachers.id, teacherOf(c).id)).returning();
    return c.json({ teacher: toMe(row!) });
  })

  .patch("/me", requireTeacher, async (c) => {
    const body = await readJson(c, updateMeBody);
    const t = teacherOf(c);
    const [row] = await db.update(schema.teachers).set({ displayName: body.displayName }).where(eq(schema.teachers.id, t.id)).returning();
    return c.json({ teacher: toMe(row!) });
  })

  // Adds an email + password to the current workspace so it can be opened elsewhere.
  .post("/register", requireTeacher, rateLimit("register", 10, 60 * 60_000), async (c) => {
    const body = await readJson(c, registerBody);
    const t = teacherOf(c);
    if (t.hasAccount) throw conflict("Este espacio ya tiene una cuenta.");
    const [taken] = await db
      .select({ id: schema.teachers.id })
      .from(schema.teachers)
      .where(and(sql`lower(${schema.teachers.email}) = ${body.email}`, ne(schema.teachers.id, t.id)))
      .limit(1);
    if (taken) throw conflict("Ya existe una cuenta con ese correo. Si es tuya, ingresá desde «Ya tengo cuenta».");
    const code = newRecoveryCode();
    const [row] = await db
      .update(schema.teachers)
      .set({
        email: body.email,
        passwordHash: await hashPassword(body.password),
        recoveryCodeHash: code.hash,
        ...(body.displayName ? { displayName: body.displayName } : {}),
      })
      .where(eq(schema.teachers.id, t.id))
      .returning();
    await audit(c, t.id, "account_created", "teacher", t.id);
    return c.json({ teacher: toMe(row!), recoveryCode: code.display });
  })

  .post("/login", rateLimit("login", 10, 15 * 60_000), async (c) => {
    const body = await readJson(c, loginBody);
    if (!hit(`login-email:${body.email}`, 8, 15 * 60_000)) {
      throw new HttpError(429, "Demasiados intentos con este correo. Esperá 15 minutos.", "rate_limited");
    }
    const [account] = await db.select().from(schema.teachers).where(sql`lower(${schema.teachers.email}) = ${body.email}`).limit(1);
    // Unknown emails still pay for one scrypt run, so the response time does not reveal which emails have an account.
    const valid = account?.passwordHash
      ? await verifyPassword(body.password, account.passwordHash)
      : await verifyPassword(body.password, await decoyHash()).then(() => false);
    if (!account || !valid) {
      await audit(c, null, "login_failed", "teacher", null, { ip: clientIp(c) });
      throw new HttpError(401, "El correo o la contraseña no coinciden.", "bad_credentials");
    }
    if (account.isSuspended) throw new HttpError(403, "Este espacio fue suspendido por el administrador del sitio.", "suspended");
    const current = c.get("teacher");
    let merged = false;
    if (current && current.id !== account.id && !current.hasAccount) {
      // Keep whatever the teacher did on this device before signing in.
      if (await workspaceHasContent(current.id)) {
        await mergeWorkspaces(current.id, account.id);
        merged = true;
      } else {
        await db.delete(schema.teachers).where(eq(schema.teachers.id, current.id));
      }
    } else if (current) {
      await db.delete(schema.teacherSessions).where(eq(schema.teacherSessions.id, current.sessionId));
    }
    await createTeacherSession(c, account.id);
    await audit(c, account.id, "login", "teacher", account.id, { merged });
    return c.json({ teacher: toMe(account), merged });
  })

  .post("/recover", rateLimit("recover", 5, 15 * 60_000), async (c) => {
    const body = await readJson(c, recoverBody);
    const [account] = await db.select().from(schema.teachers).where(sql`lower(${schema.teachers.email}) = ${body.email}`).limit(1);
    const ok = account?.recoveryCodeHash === sha256(normalizeCode(body.recoveryCode));
    if (!account || !ok) {
      await audit(c, null, "recover_failed", "teacher", null, {});
      throw new HttpError(401, "El correo o el código de recuperación no coinciden.", "bad_credentials");
    }
    const code = newRecoveryCode();
    await db
      .update(schema.teachers)
      .set({ passwordHash: await hashPassword(body.newPassword), recoveryCodeHash: code.hash })
      .where(eq(schema.teachers.id, account.id));
    // Same as sign-in: keep what was done on this device without an account.
    const current = c.get("teacher");
    let merged = false;
    if (current && current.id !== account.id && !current.hasAccount) {
      if (await workspaceHasContent(current.id)) {
        await mergeWorkspaces(current.id, account.id);
        merged = true;
      } else {
        await db.delete(schema.teachers).where(eq(schema.teachers.id, current.id));
      }
    }
    await db.delete(schema.teacherSessions).where(eq(schema.teacherSessions.teacherId, account.id));
    await createTeacherSession(c, account.id);
    await audit(c, account.id, "password_recovered", "teacher", account.id, { merged });
    return c.json({ teacher: toMe(account), recoveryCode: code.display, merged });
  })

  .post("/password", requireTeacher, rateLimit("password", 10, 15 * 60_000), async (c) => {
    const body = await readJson(c, changePasswordBody);
    const t = teacherOf(c);
    const row = await getTeacher(t.id);
    if (!row?.passwordHash) throw badRequest("Este espacio todavía no tiene cuenta.");
    if (!(await verifyPassword(body.currentPassword, row.passwordHash))) {
      throw new HttpError(401, "La contraseña actual no es correcta.", "bad_credentials", { currentPassword: "No coincide." });
    }
    // A new password also invalidates the old recovery code (a leaked code must not outlive it).
    const code = newRecoveryCode();
    await db
      .update(schema.teachers)
      .set({ passwordHash: await hashPassword(body.newPassword), recoveryCodeHash: code.hash })
      .where(eq(schema.teachers.id, t.id));
    // Other devices must sign in again.
    await db.delete(schema.teacherSessions).where(and(eq(schema.teacherSessions.teacherId, t.id), ne(schema.teacherSessions.id, t.sessionId)));
    await audit(c, t.id, "password_changed", "teacher", t.id);
    return c.json({ ok: true, recoveryCode: code.display });
  })

  .post("/recovery-code", requireTeacher, async (c) => {
    const t = teacherOf(c);
    if (!t.hasAccount) throw badRequest("Este espacio todavía no tiene cuenta.");
    const code = newRecoveryCode();
    await db.update(schema.teachers).set({ recoveryCodeHash: code.hash }).where(eq(schema.teachers.id, t.id));
    await audit(c, t.id, "recovery_code_rotated", "teacher", t.id);
    return c.json({ recoveryCode: code.display });
  })

  // Only accounts can sign out: an anonymous workspace would become unreachable.
  .post("/logout", requireTeacher, async (c) => {
    const t = teacherOf(c);
    if (!t.hasAccount) {
      throw badRequest("Este espacio no tiene cuenta: si salís no vas a poder volver a entrar. Creá una cuenta primero o borrá el espacio.");
    }
    await db.delete(schema.teacherSessions).where(eq(schema.teacherSessions.id, t.sessionId));
    clearTeacherCookie(c);
    return c.json({ ok: true });
  })

  .delete("/workspace", requireTeacher, async (c) => {
    await readJson(c, deleteWorkspaceBody);
    const t = teacherOf(c);
    await audit(c, t.id, "workspace_deleted", "teacher", t.id);
    await deleteWorkspace(t.id);
    clearTeacherCookie(c);
    return c.json({ ok: true });
  });

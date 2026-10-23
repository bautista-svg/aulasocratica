// What signing in with Google does to accounts and to the workspace open on this device.
// The Google account id ("sub") is the key; the first time, a verified email that already has
// an account is linked to it (so a teacher who registered with a password keeps everything).
import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { hit } from "../lib/rate-limit";
import { createTeacherSession } from "../auth/teacher";
import type { GoogleProfile } from "../auth/google";
import { audit } from "./audit";
import { mergeWorkspaces, workspaceHasContent } from "./workspace";

export type GoogleSignIn = "ok" | "suspended" | "other_google" | "busy";

export async function signInWithGoogle(c: Context<AppEnv>, p: GoogleProfile): Promise<GoogleSignIn> {
  const current = c.get("teacher");
  let [account] = await db.select().from(schema.teachers).where(eq(schema.teachers.googleSub, p.sub)).limit(1);
  let linked = false;
  if (!account) {
    const [byEmail] = await db.select().from(schema.teachers).where(sql`lower(${schema.teachers.email}) = ${p.email}`).limit(1);
    if (byEmail) {
      if (byEmail.googleSub && byEmail.googleSub !== p.sub) return "other_google";
      if (byEmail.isSuspended) return "suspended";
      [account] = await db.update(schema.teachers).set({ googleSub: p.sub }).where(eq(schema.teachers.id, byEmail.id)).returning();
      linked = true;
    }
  }

  if (account) {
    if (account.isSuspended) return "suspended";
    if (current?.id === account.id) return "ok";
    let merged = false;
    if (current && !current.hasAccount) {
      // Same as signing in with a password: what was done on this device without an account is kept.
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
    await audit(c, account.id, "login", "teacher", account.id, { via: "google", merged, linked });
    return "ok";
  }

  // No account yet: the workspace open on this device becomes the account.
  if (current && !current.hasAccount) {
    await db
      .update(schema.teachers)
      .set({ email: p.email, googleSub: p.sub, displayName: sql`case when ${schema.teachers.displayName} = '' then ${p.name} else ${schema.teachers.displayName} end` })
      .where(eq(schema.teachers.id, current.id));
    await audit(c, current.id, "account_created", "teacher", current.id, { via: "google" });
    return "ok";
  }
  if (!hit("start-global", 300, 60 * 60_000)) return "busy";
  if (current) await db.delete(schema.teacherSessions).where(eq(schema.teacherSessions.id, current.sessionId));
  const [row] = await db.insert(schema.teachers).values({ email: p.email, googleSub: p.sub, displayName: p.name }).returning();
  await createTeacherSession(c, row!.id);
  await audit(c, row!.id, "account_created", "teacher", row!.id, { via: "google", new: true });
  return "ok";
}

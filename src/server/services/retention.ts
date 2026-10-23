// Data retention (documented in /privacidad and docs/OPERACION.md):
// - Empty anonymous workspaces (nothing created) are removed after 30 days without use.
// - Anonymous workspaces with content are removed after 12 months without use.
//   Workspaces with an account are kept until the teacher deletes them.
// - Expired sessions/tokens, interrupted partial tutor replies and old operational logs are purged.
import { and, isNull, lt, sql, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { registerJob } from "../jobs";
import { log } from "../lib/logger";
import { deleteWorkspace, workspaceHasContent } from "./workspace";

const DAY = 86_400_000;

export async function runRetention(now = Date.now()) {
  const sessions = await db.delete(schema.teacherSessions).where(lt(schema.teacherSessions.expiresAt, new Date(now))).returning({ id: schema.teacherSessions.id });
  const tokens = await db.delete(schema.studentTokens).where(lt(schema.studentTokens.expiresAt, new Date(now))).returning({ id: schema.studentTokens.id });
  const partials = await db
    .delete(schema.messages)
    .where(and(eq(schema.messages.isPartial, true), lt(schema.messages.createdAt, new Date(now - 10 * 60_000))))
    .returning({ id: schema.messages.id });
  await db.delete(schema.auditLogs).where(lt(schema.auditLogs.createdAt, new Date(now - 180 * DAY)));
  await db.delete(schema.aiUsage).where(lt(schema.aiUsage.createdAt, new Date(now - 400 * DAY)));

  const candidates = await db
    .select({ id: schema.teachers.id, lastSeenAt: schema.teachers.lastSeenAt })
    .from(schema.teachers)
    .where(
      and(isNull(schema.teachers.passwordHash), isNull(schema.teachers.googleSub), lt(schema.teachers.lastSeenAt, new Date(now - 30 * DAY))),
    )
    .limit(500);
  let removed = 0;
  for (const t of candidates) {
    const idleDays = (now - t.lastSeenAt.getTime()) / DAY;
    if (idleDays >= 365 || !(await workspaceHasContent(t.id))) {
      await deleteWorkspace(t.id);
      removed++;
    }
  }
  log.info("retention_run", {
    expiredSessions: sessions.length,
    expiredStudentTokens: tokens.length,
    partialMessages: partials.length,
    workspacesRemoved: removed,
  });
}

registerJob({ name: "retention", everyMs: 6 * 60 * 60_000, run: () => runRetention() });

/** Used by /admin: how many workspaces of each kind exist. */
export async function workspaceCounts() {
  const [r] = await db.execute<{ total: number; accounts: number }>(sql`
    select count(*)::int as total, count(*) filter (where password_hash is not null or google_sub is not null)::int as accounts from teachers`);
  return r ?? { total: 0, accounts: 0 };
}

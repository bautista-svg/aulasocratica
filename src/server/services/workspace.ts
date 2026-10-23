// Workspace lifecycle: create, merge an anonymous workspace into an account, delete.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { deleteFile, deletePrefix } from "../lib/storage";
import { log } from "../lib/logger";
import type { Me } from "@shared/contracts/auth";

export function toMe(t: typeof schema.teachers.$inferSelect): Me {
  return {
    id: t.id,
    displayName: t.displayName,
    email: t.email,
    hasAccount: Boolean(t.email && (t.passwordHash || t.googleSub)),
    hasPassword: Boolean(t.passwordHash),
    google: Boolean(t.googleSub),
    createdAt: t.createdAt.toISOString(),
    newsSeen: t.newsSeen,
    canRequestChanges: t.canRequestChanges,
  };
}

export async function getTeacher(id: string) {
  const [row] = await db.select().from(schema.teachers).where(eq(schema.teachers.id, id)).limit(1);
  return row ?? null;
}

/** Does this workspace hold anything the teacher created (besides untouched preset tutors)? */
export async function workspaceHasContent(teacherId: string): Promise<boolean> {
  const [r] = await db.execute<{ has: boolean }>(sql`
    select exists(select 1 from classrooms where teacher_id = ${teacherId})
        or exists(select 1 from materials where teacher_id = ${teacherId})
        or exists(select 1 from reports where teacher_id = ${teacherId})
        or exists(select 1 from tutors where teacher_id = ${teacherId} and (preset_key is null or updated_at > created_at + interval '1 second'))
      as has`);
  return Boolean(r?.has);
}

/**
 * Moves everything from an anonymous workspace into an account (used when a teacher who
 * already worked without an account signs in on the same device). Nothing is lost:
 * preset tutors the anonymous workspace edited are kept as separate custom tutors.
 */
export async function mergeWorkspaces(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  await db.transaction(async (tx) => {
    await tx.update(schema.classrooms).set({ teacherId: intoId }).where(eq(schema.classrooms.teacherId, fromId));
    await tx.update(schema.activities).set({ teacherId: intoId }).where(eq(schema.activities.teacherId, fromId));
    await tx.update(schema.materials).set({ teacherId: intoId }).where(eq(schema.materials.teacherId, fromId));
    await tx.update(schema.reports).set({ teacherId: intoId }).where(eq(schema.reports.teacherId, fromId));
    // Custom tutors move as they are.
    await tx
      .update(schema.tutors)
      .set({ teacherId: intoId })
      .where(and(eq(schema.tutors.teacherId, fromId), sql`${schema.tutors.presetKey} is null`));
    // Edited presets become custom tutors in the account; untouched presets are dropped
    // (the account has its own copy). Activities keep pointing at the moved rows.
    await tx
      .update(schema.tutors)
      .set({ teacherId: intoId, presetKey: null, name: sql`left(${schema.tutors.name} || ' (de este dispositivo)', 120)` })
      .where(
        and(
          eq(schema.tutors.teacherId, fromId),
          isNotNull(schema.tutors.presetKey),
          sql`${schema.tutors.updatedAt} > ${schema.tutors.createdAt} + interval '1 second'`,
        ),
      );
    await tx.update(schema.changeRequests).set({ teacherId: intoId }).where(eq(schema.changeRequests.teacherId, fromId));
    await tx.update(schema.aiUsage).set({ teacherId: intoId }).where(eq(schema.aiUsage.teacherId, fromId));
    await tx.update(schema.auditLogs).set({ teacherId: intoId }).where(eq(schema.auditLogs.teacherId, fromId));
    await tx.delete(schema.teachers).where(eq(schema.teachers.id, fromId));
  });
  log.info("workspace_merged", { fromId, intoId });
}

/** Permanently deletes a workspace, its rows (cascade) and its files on disk. */
export async function deleteWorkspace(teacherId: string): Promise<void> {
  const fileKeys = await collectWorkspaceFileKeys(teacherId);
  await db.delete(schema.teachers).where(eq(schema.teachers.id, teacherId));
  for (const key of fileKeys) await deleteFile(key);
  await deletePrefix(`requests/${teacherId}`).catch(() => {});
  log.info("workspace_deleted", { teacherId, files: fileKeys.length });
}

export async function collectWorkspaceFileKeys(teacherId: string): Promise<string[]> {
  const lib = await db
    .select({ key: schema.materials.storageKey })
    .from(schema.materials)
    .where(and(eq(schema.materials.teacherId, teacherId), isNotNull(schema.materials.storageKey)));
  const acts = await db.select({ id: schema.activities.id }).from(schema.activities).where(eq(schema.activities.teacherId, teacherId));
  const files = acts.length
    ? await db
        .select({ key: schema.activityFiles.storageKey })
        .from(schema.activityFiles)
        .where(inArray(schema.activityFiles.activityId, acts.map((a) => a.id)))
    : [];
  const handedIn = acts.length
    ? await db
        .select({ key: schema.sessionDeliverables.storageKey })
        .from(schema.sessionDeliverables)
        .where(inArray(schema.sessionDeliverables.activityId, acts.map((a) => a.id)))
    : [];
  // Links handed in have nothing stored.
  return [...lib.map((r) => r.key!), ...files.map((r) => r.key), ...handedIn.flatMap((r) => (r.key ? [r.key] : []))];
}

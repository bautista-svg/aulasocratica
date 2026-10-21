// Disk quota per teacher workspace: every path that stores a file (activity uploads, library
// uploads, duplicating an activity, copying a library file into an activity) checks it first.
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { env } from "../env";
import { HttpError } from "../lib/errors";

export async function storageUsedBytes(teacherId: string): Promise<number> {
  const [row] = await db.execute<{ used: string | number }>(sql`
    select
      coalesce((select sum(f.size_bytes) from activity_files f join activities a on a.id = f.activity_id where a.teacher_id = ${teacherId}), 0)
      + coalesce((select sum(m.size_bytes) from materials m where m.teacher_id = ${teacherId}), 0)
      + coalesce((select sum(d.size_bytes) from session_deliverables d join activities a on a.id = d.activity_id where a.teacher_id = ${teacherId}), 0) as used`);
  return Number(row?.used ?? 0);
}

export async function assertStorageRoom(teacherId: string, incomingBytes: number): Promise<void> {
  const quota = env.STORAGE_QUOTA_MB_PER_WORKSPACE * 1024 * 1024;
  const used = await storageUsedBytes(teacherId);
  if (used + incomingBytes > quota) {
    const freeMb = Math.max(0, Math.floor((quota - used) / (1024 * 1024)));
    throw new HttpError(
      413,
      `Tu espacio llegó al máximo de ${env.STORAGE_QUOTA_MB_PER_WORKSPACE.toLocaleString("es-AR")} MB de archivos (quedan ${freeMb} MB). Borrá archivos o actividades que ya no uses.`,
      "storage_quota",
    );
  }
}

// Seeds the built-in tutors into a workspace (one editable row per tutor type).
// Idempotent and safe under concurrency: a partial unique index on (teacher_id, preset_key)
// plus ON CONFLICT DO NOTHING, all in one transaction, and a "seeded at" mark on the teacher
// so the insert runs once per workspace (again only when PRESETS_VERSION adds presets).
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { log } from "../../lib/logger";
import { PRESETS_VERSION, TUTOR_PRESETS } from "@shared/domain/tutor-presets";

const presetsSince = new Date(PRESETS_VERSION);

export async function ensurePresetTutors(teacherId: string): Promise<void> {
  const [t] = await db
    .select({ seededAt: schema.teachers.tutorsSeededAt })
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId))
    .limit(1);
  if (!t) return;
  if (t.seededAt && t.seededAt >= presetsSince) return;
  await seedPresetTutors(teacherId);
}

export async function seedPresetTutors(teacherId: string): Promise<number> {
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.tutors)
      .values(TUTOR_PRESETS.map((p) => ({ teacherId, presetKey: p.key, ...p.values })))
      .onConflictDoNothing()
      .returning({ id: schema.tutors.id });
    await tx.update(schema.teachers).set({ tutorsSeededAt: new Date() }).where(eq(schema.teachers.id, teacherId));
    return rows.length;
  });
  if (inserted) log.info("tutor_presets_seeded", { teacherId, inserted });
  return inserted;
}

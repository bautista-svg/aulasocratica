// Which skills a workspace evaluates, and its own skills (teachers.skill_settings; null = defaults).
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { sanitizeSkillSettings, type SkillSettings } from "@shared/domain/skills";

export async function skillSettingsOf(teacherId: string): Promise<SkillSettings> {
  const [row] = await db
    .select({ settings: schema.teachers.skillSettings })
    .from(schema.teachers)
    .where(eq(schema.teachers.id, teacherId))
    .limit(1);
  return sanitizeSkillSettings(row?.settings ?? null);
}

export async function saveSkillSettings(teacherId: string, raw: unknown): Promise<SkillSettings> {
  const settings = sanitizeSkillSettings(raw);
  await db.update(schema.teachers).set({ skillSettings: settings }).where(eq(schema.teachers.id, teacherId));
  return settings;
}

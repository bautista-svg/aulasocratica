// Read models for "Mis tutores".
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../../db/client";
import type { TutorDetail, TutorSummary } from "@shared/contracts/tutors";
import { composeTutorRules, type TutorConfig } from "@shared/domain/tutors";

type TutorRow = typeof schema.tutors.$inferSelect;

/**
 * "Edited preset" = updated after it was seeded. The same rule (with one second of slack)
 * is used when an anonymous workspace is merged into an account (services/workspace.ts).
 */
const customizedSql = sql<boolean>`(tutors.preset_key is not null and tutors.updated_at > tutors.created_at + interval '1 second')`;
const usedSql = sql<number>`(select count(*)::int from activities a where a.tutor_id = tutors.id)`;

function toSummary(r: TutorRow, extra: { customized: boolean; usedInActivities: number }): TutorSummary {
  return {
    id: r.id,
    name: r.name,
    presetKey: r.presetKey,
    tutorType: r.tutorType,
    subject: r.subject,
    helpLevel: r.helpLevel as TutorSummary["helpLevel"],
    difficulty: r.difficulty as TutorSummary["difficulty"],
    customized: Boolean(extra.customized),
    usedInActivities: extra.usedInActivities,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toDetail(r: TutorRow, extra: { customized: boolean; usedInActivities: number }): TutorDetail {
  return {
    ...toSummary(r, extra),
    studentAge: r.studentAge,
    objectives: r.objectives,
    questionStyle: r.questionStyle,
    strategies: r.strategies,
    closingCriteria: r.closingCriteria,
    rules: r.rules,
  };
}

const collator = new Intl.Collator("es", { sensitivity: "base" });

/** Custom tutors first (most recently edited first), then presets by name. */
export async function listTutors(teacherId: string): Promise<TutorSummary[]> {
  const rows = await db
    .select({ t: schema.tutors, customized: customizedSql, usedInActivities: usedSql })
    .from(schema.tutors)
    .where(eq(schema.tutors.teacherId, teacherId));
  const all = rows.map((r) => toSummary(r.t, r));
  const custom = all.filter((t) => !t.presetKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const presets = all.filter((t) => t.presetKey).sort((a, b) => collator.compare(a.name, b.name));
  return [...custom, ...presets];
}

export async function tutorDetail(teacherId: string, tutorId: string, where?: SQL): Promise<TutorDetail | null> {
  const [row] = await db
    .select({ t: schema.tutors, customized: customizedSql, usedInActivities: usedSql })
    .from(schema.tutors)
    .where(and(eq(schema.tutors.teacherId, teacherId), eq(schema.tutors.id, tutorId), where))
    .limit(1);
  return row ? toDetail(row.t, row) : null;
}

/** The teacher indications a saved tutor contributes to an activity (below the global rules). */
export function rulesOfTutor(t: TutorRow): string {
  const cfg: Partial<TutorConfig> = {
    student_age: t.studentAge,
    difficulty: t.difficulty,
    objectives: t.objectives,
    question_style: t.questionStyle,
    strategies: t.strategies,
    closing_criteria: t.closingCriteria,
    rules: t.rules,
  };
  return composeTutorRules(cfg);
}

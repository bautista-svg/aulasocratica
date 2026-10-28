// "Habilidades": what the teacher sees of each work, of the group and of each student, and the
// workspace's choice of skills.
import { z } from "zod";
import {
  CRITERION_MAX,
  DIMENSION_KEYS,
  MAX_CRITERIA,
  MAX_CUSTOM_SKILLS,
  SKILL_LABEL_MAX,
  SKILL_STATUSES,
  type SkillAssessment,
  type SkillDef,
  type SkillDimension,
  type SkillSettings,
  type SkillStatus,
  type StatusCounts,
} from "../domain/skills";

/** One work's evaluation. `catalog`: the skills the workspace evaluates now. */
export interface SkillsView {
  skills: SkillAssessment[];
  recommendations: string[];
  interventions: number;
  skillsAt: string | null;
  catalog: SkillDef[];
}

export interface SkillsAnalyzeResult extends SkillsView {
  /** Levels the AI gave without a real quote of the student (turned into "sin evidencia"). */
  droppedQuotes: number;
}

/** The teacher rewrites the recommendations of one work (one per line in the editor). */
export const recommendationsBody = z.object({
  recommendations: z.array(z.string().trim().max(400, "Cada recomendación, hasta 400 caracteres.")).max(6, "Hasta 6 recomendaciones."),
});

/** The teacher corrects the level of one skill in one work. */
export const skillLevelBody = z.object({
  status: z.enum(SKILL_STATUSES as [SkillStatus, ...SkillStatus[]], { error: "Elegí un nivel." }),
});

/** One student's evaluation in a skill, as listed in the group view. */
export interface SkillStudentEntry extends Omit<SkillAssessment, "skill" | "label" | "dimension"> {
  sessionId: string;
  studentName: string;
}

export interface SkillGroupRow extends SkillDef {
  counts: StatusCounts;
  students: SkillStudentEntry[];
}

/** "Reevaluar habilidades" of an activity (the latest run). */
export interface SkillRunView {
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  error: string;
  startedAt: string;
  finishedAt: string | null;
}

/** The group view of an activity. */
export interface ActivitySkills {
  totalWorks: number;
  completedWorks: number;
  /** Works evaluated by skills. */
  assessedWorks: number;
  /** The students' interventions those evaluations read (not a measure of quality). */
  interventions: number;
  /** Finished works with something written that are not evaluated by skills yet. */
  pending: { sessionId: string; studentName: string }[];
  /** Evaluated works whose evaluation used older criteria (can be evaluated again). */
  outdatedWorks: number;
  /**
   * Other evaluated works where a skill was leveled with numbers per level the teacher has changed
   * since (or set or removed): «Reevaluar habilidades» applies the current ones.
   */
  levelsOutdatedWorks: number;
  skills: SkillGroupRow[];
  /** The latest re-evaluation of the whole activity, if any. */
  run: SkillRunView | null;
}

/** One skill of one student across activities, oldest first. */
export interface StudentSkillHistory extends SkillDef {
  history: (Omit<SkillAssessment, "skill" | "label" | "dimension"> & { sessionId: string; activityTitle: string; at: string })[];
}

export interface StudentSkills {
  assessedWorks: number;
  skills: StudentSkillHistory[];
  /** From the latest evaluated work. */
  recommendations: string[];
}

// ── Settings ──

const customSkillBody = z.object({
  id: z.string().regex(/^c_[a-z0-9]{4,16}$/, "Habilidad inválida."),
  label: z.string().trim().min(1, "Escribí el nombre de la habilidad.").max(SKILL_LABEL_MAX, `Usá hasta ${SKILL_LABEL_MAX} caracteres.`),
  dimension: z.enum(DIMENSION_KEYS as [SkillDimension, ...SkillDimension[]], { error: "Elegí una dimensión." }),
  criteria: z
    .array(z.string().trim().min(1).max(CRITERION_MAX, `Cada indicador, hasta ${CRITERION_MAX} caracteres.`))
    .min(1, "Escribí al menos un indicador.")
    .max(MAX_CRITERIA, `Hasta ${MAX_CRITERIA} indicadores.`),
});

const threshold = z.number({ error: "Elegí cuántos indicadores." }).int().min(0).max(MAX_CRITERIA);

export const skillSettingsBody = z.object({
  enabled: z.array(z.string().max(40)).max(40),
  custom: z.array(customSkillBody).max(MAX_CUSTOM_SKILLS, `Hasta ${MAX_CUSTOM_SKILLS} habilidades propias.`),
  /** Unticked indicators by skill (unknown ones are dropped). */
  off: z.record(z.string().max(40), z.array(z.string().max(CRITERION_MAX)).max(MAX_CRITERIA)).optional(),
  /** How many ticked indicators each level asks for, by skill (fitted to the ticked ones; see clampThresholds). */
  levels: z.record(z.string().max(40), z.object({ inicial: threshold, en_desarrollo: threshold, logrado: threshold, avanzado: threshold })).optional(),
});
export type SkillSettingsInput = z.input<typeof skillSettingsBody>;

export interface SkillSettingsResponse {
  settings: SkillSettings;
  catalog: SkillDef[];
}

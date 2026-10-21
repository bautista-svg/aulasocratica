import { z } from "zod";

/** A saved tutor in "Mis tutores". Built-in presets are copied into every workspace (presetKey set). */
export interface TutorSummary {
  id: string;
  name: string;
  presetKey: string | null;
  tutorType: string;
  subject: string;
  helpLevel: "autonomous" | "moderate" | "intensive";
  difficulty: "basica" | "intermedia" | "avanzada";
  /** True when a preset was edited by the teacher (it can be restored to the original). */
  customized: boolean;
  usedInActivities: number;
  updatedAt: string;
}

export interface TutorDetail extends TutorSummary {
  studentAge: string;
  objectives: string;
  questionStyle: string;
  strategies: string;
  closingCriteria: string;
  rules: string;
}

const text = (max: number) => z.string().trim().max(max, `Usá hasta ${max} caracteres.`);

export const tutorBody = z.object({
  name: z.string().trim().min(1, "Poné un nombre.").max(120),
  tutorType: z.string().min(1).max(40),
  subject: text(80).default(""),
  studentAge: text(60).default(""),
  objectives: text(2000).default(""),
  questionStyle: text(1000).default(""),
  difficulty: z.enum(["basica", "intermedia", "avanzada"]).default("intermedia"),
  helpLevel: z.enum(["autonomous", "moderate", "intensive"]).default("moderate"),
  strategies: text(2000).default(""),
  closingCriteria: text(1000).default(""),
  rules: text(3000).default(""),
});
export type TutorInput = z.input<typeof tutorBody>;

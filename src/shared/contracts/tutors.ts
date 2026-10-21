import { z } from "zod";
import { TUTOR_TYPES } from "../domain/pedagogy";

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
  name: z.string().trim().min(1, "Poné un nombre.").max(120, "Usá hasta 120 caracteres."),
  tutorType: z
    .string()
    .min(1)
    .max(40)
    .refine((v) => v in TUTOR_TYPES, "Elegí un tipo de tutor de la lista."),
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

/** POST: a new tutor plus an optional request id (a repeated id returns the tutor created the first time). */
export const tutorCreateBody = tutorBody.extend({ requestId: z.string().uuid().optional() });
export type TutorCreateInput = z.input<typeof tutorCreateBody>;

/** POST /:id/duplicate. */
export const tutorDuplicateBody = z.object({ requestId: z.string().uuid().optional() });

/** PATCH: any subset of the fields (no defaults applied, so missing fields stay as they are). */
export const tutorPatch = z.object({
  name: z.string().trim().min(1, "Poné un nombre.").max(120, "Usá hasta 120 caracteres.").optional(),
  tutorType: z
    .string()
    .min(1)
    .max(40)
    .refine((v) => v in TUTOR_TYPES, "Elegí un tipo de tutor de la lista.")
    .optional(),
  subject: text(80).optional(),
  studentAge: text(60).optional(),
  objectives: text(2000).optional(),
  questionStyle: text(1000).optional(),
  difficulty: z.enum(["basica", "intermedia", "avanzada"]).optional(),
  helpLevel: z.enum(["autonomous", "moderate", "intensive"]).optional(),
  strategies: text(2000).optional(),
  closingCriteria: text(1000).optional(),
  rules: text(3000).optional(),
});
export type TutorPatch = z.input<typeof tutorPatch>;

/** Max custom tutors (presets do not count). */
export const MAX_CUSTOM_TUTORS = 200;

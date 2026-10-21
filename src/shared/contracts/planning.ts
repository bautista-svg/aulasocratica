import { z } from "zod";
import { ACTIVITY_TYPES, COGNITIVE_SKILLS, LIMITS, type ClassProposal } from "../domain/planning";
import { MAX_PICK } from "../domain/library";

const text = (max: number) => z.string().trim().max(max, `Usá hasta ${max} caracteres.`);

/** Pasted text in the wizard (goes to the AI and, at the end, to the activity's written material). */
export const MAX_EXTRA_TEXT = 50_000;

export const proposalsBody = z.object({
  classroomId: z.string().uuid().nullable().optional(),
  subject: text(80).default(""),
  grade: text(60).default(""),
  topic: z.string().trim().min(2, "Escribí el tema de la clase.").max(200, "Usá hasta 200 caracteres."),
  durationMinutes: z.number().int().min(5, "La duración mínima es de 5 minutos.").max(600, "Usá hasta 600 minutos.").nullable().optional(),
  priorKnowledge: text(2000).default(""),
  skills: z.array(z.enum(COGNITIVE_SKILLS)).max(COGNITIVE_SKILLS.length).default([]),
  activityTypes: z.array(z.enum(ACTIVITY_TYPES)).max(ACTIVITY_TYPES.length).default([]),
  difficulty: z.enum(["basica", "intermedia", "avanzada"]).default("intermedia"),
  materialIds: z.array(z.string().uuid()).max(MAX_PICK, `Podés elegir hasta ${MAX_PICK} materiales.`).default([]),
  extraText: text(MAX_EXTRA_TEXT).default(""),
  /** Optional extra request ("que sea en grupos", "otra más corta"…). */
  request: text(600).default(""),
});
export type ProposalsInput = z.input<typeof proposalsBody>;

export interface MaterialUsage {
  /** "full": the AI read everything; "excerpts": the material was long and it read the most related fragments. */
  mode: "full" | "excerpts" | "empty";
  totalChars: number;
  sentChars: number;
  materials: { id: string; title: string; chars: number; pageCount: number | null }[];
}

export interface ProposalsResponse {
  proposals: ClassProposal[];
  material: MaterialUsage;
}

const proposalSchema = z.object({
  activityType: text(80).default(""),
  title: z.string().trim().min(1, "Poné un título.").max(LIMITS.title, `Usá hasta ${LIMITS.title} caracteres.`),
  instructions: z.string().trim().min(1, "Escribí la consigna.").max(LIMITS.instructions, `Usá hasta ${LIMITS.instructions} caracteres.`),
  objectives: text(LIMITS.objectives).default(""),
  teacherNotes: text(LIMITS.teacherNotes).default(""),
  tutorType: z.string().max(40).default("pensamiento_critico"),
  helpLevel: z.enum(["autonomous", "moderate", "intensive"]).default("moderate"),
  tutorGuidance: text(LIMITS.tutorGuidance).default(""),
  reflectionQuestions: z.array(z.string().max(LIMITS.reflection, `Usá hasta ${LIMITS.reflection} caracteres.`)).max(6).default([]),
  materialRefs: z.array(z.string().max(LIMITS.materialRef)).max(LIMITS.materialRefs).default([]),
});

export const createFromProposalBody = z.object({
  classroomId: z.string().uuid("Elegí un aula."),
  subject: text(80).default(""),
  proposal: proposalSchema,
  /** A tutor of "Mis tutores": its configuration is copied into the activity. */
  tutorId: z.string().uuid().nullable().optional(),
  materialIds: z.array(z.string().uuid()).max(MAX_PICK, `Podés elegir hasta ${MAX_PICK} materiales.`).default([]),
  extraText: text(MAX_EXTRA_TEXT).default(""),
  publish: z.boolean().default(false),
  /** Same id again (double click, retry after a lost response) → the activity created the first time. */
  requestId: z.string().uuid().optional(),
});
export type CreateFromProposalInput = z.input<typeof createFromProposalBody>;

export interface CreateFromProposalResponse {
  activityId: string;
  status: "draft" | "published";
  attached: number;
  /** Materials that could not be attached, with the reason. */
  skipped: { title: string; reason: string }[];
}

import { z } from "zod";
import { NARRATIVE_MAX, type ReportData, type ReportKind, type ReportStatus } from "../domain/reports";

const uuid = (what: string) => z.string().uuid(`Elegí ${what}.`);
const title = z.string().trim().min(1, "Poné un título.").max(200, "Usá hasta 200 caracteres.");

/**
 * New report: only the kind and what it covers. The observed data is always built on the
 * server from the database; any numbers sent by the browser are ignored (unknown keys are dropped).
 */
export const createReportBody = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("individual"),
      scope: z
        .object({ studentId: uuid("un alumno").optional(), sessionId: uuid("un trabajo").optional() })
        .refine((s) => Boolean(s.studentId || s.sessionId), { message: "Elegí un alumno.", path: ["studentId"] }),
      title: title.optional(),
    }),
    z.object({
      kind: z.literal("group"),
      scope: z
        .object({ classroomId: uuid("un aula").optional(), activityId: uuid("una actividad").optional() })
        .refine((s) => Boolean(s.classroomId || s.activityId), { message: "Elegí un aula.", path: ["classroomId"] }),
      title: title.optional(),
    }),
    z.object({
      kind: z.literal("overview"),
      scope: z.object({}).optional(),
      title: title.optional(),
    }),
  ],
  { error: "Elegí el tipo de informe." },
);
export type CreateReportInput = z.input<typeof createReportBody>;

export const patchReportBody = z
  .object({
    title: title.optional(),
    narrative: z.record(z.string(), z.string().max(NARRATIVE_MAX, `Cada sección admite hasta ${NARRATIVE_MAX} caracteres.`)).optional(),
  })
  .refine((v) => v.title !== undefined || v.narrative !== undefined, { message: "No hay cambios para guardar." });

/** What a report covers, stored with the report (ids + the names at the time it was created). */
export interface ReportScope {
  studentId?: string;
  sessionId?: string;
  activityId?: string;
  classroomId?: string;
  /** Human-readable description, e.g. "5.º B · Juan Pérez". */
  label: string;
}

export interface ReportSummary {
  id: string;
  kind: ReportKind;
  title: string;
  status: ReportStatus;
  scopeLabel: string;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
}

export interface ReportDetail extends ReportSummary {
  scope: ReportScope;
  data: ReportData;
  narrative: Record<string, string>;
}

export interface ReportResponse {
  report: ReportDetail;
}

export interface ReportListResponse {
  reports: ReportSummary[];
}

/** AI draft of the narrative sections: a suggestion, never saved by the server. */
export interface ReportDraftResponse {
  draft: Record<string, string>;
}

// The teacher's alerts panel: every student's alerts across all classrooms and activities.
import { z } from "zod";
import type { AlertStatus } from "./live";

export const ALERT_INBOX_STATUSES = ["open", "reviewed", "dismissed", "all"] as const;
export type AlertInboxStatus = (typeof ALERT_INBOX_STATUSES)[number];
export const ALERT_INBOX_SEVERITIES = ["immediate", "review"] as const;
export const ALERT_INBOX_ORIGINS = ["ai", "observed"] as const;

export const alertInboxQuery = z.object({
  status: z.enum(ALERT_INBOX_STATUSES).default("open"),
  classroomId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  severity: z.enum(ALERT_INBOX_SEVERITIES).optional(),
  origin: z.enum(ALERT_INBOX_ORIGINS).optional(),
  cursor: z.string().max(400).optional(),
});
export type AlertInboxQuery = z.infer<typeof alertInboxQuery>;

/** Several alerts at once (e.g. "Marcar como revisadas" on the alerts shown). */
export const bulkAlertStatusBody = z.object({
  ids: z.array(z.string().uuid()).min(1, "Elegí al menos una alerta.").max(200, "Podés cambiar hasta 200 alertas a la vez."),
  status: z.enum(["open", "reviewed", "dismissed"], { error: "Elegí un estado válido para la alerta." }),
});

export interface AlertInboxItem {
  id: string;
  sessionId: string;
  activityId: string;
  activityTitle: string;
  classroomId: string;
  classroomLabel: string;
  studentId: string;
  studentName: string;
  alertKey: string;
  name: string;
  category: string;
  severity: "review" | "immediate";
  /** "observed" = recorded by the browser (paste, leaving the app); "ai" = inferred by the AI from the text. */
  origin: "ai" | "observed";
  evidence: string;
  reason: string;
  status: AlertStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AlertInboxCounts {
  open: number;
  /** Open alerts that need immediate attention. */
  immediate: number;
  reviewed: number;
  dismissed: number;
}

/** GET /api/alerts — one page of alerts plus the counts per status for the same filters. */
export interface AlertInboxResponse {
  items: AlertInboxItem[];
  nextCursor: string | null;
  counts: AlertInboxCounts;
}

/** GET /api/alerts/count — for the navigation badge. */
export interface AlertCountResponse {
  open: number;
  immediate: number;
}

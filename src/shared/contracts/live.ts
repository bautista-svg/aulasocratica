// Live view of ONE activity: its participants are the activity's learning sessions
// (students who joined this activity), never the whole classroom roster.
import { z } from "zod";
import type { HELP_EVENT_TYPES, LiveStatus, Stage } from "../domain/live-monitor";
import type { ClassroomRole } from "../domain/sharing";

export const alertStatusBody = z.object({
  status: z.enum(["open", "reviewed", "dismissed"], { error: "Elegí un estado válido para la alerta." }),
});
export type AlertStatus = z.infer<typeof alertStatusBody>["status"];

/** Destructive or bulk actions must be confirmed explicitly by the client. */
export const confirmBody = z.object({
  confirm: z.literal(true, { error: "Confirmá la acción para continuar." }),
});

/** "Terminar para todos": by default the link is closed too, so nobody new can join. */
export const endAllBody = confirmBody.extend({
  closeLink: z.boolean().default(true),
});
export type EndAllInput = z.input<typeof endAllBody>;
export interface EndAllResponse {
  ended: number;
  /** True when this request turned the link off (it was open). */
  linkClosed: boolean;
}

/** Time range of the "activity over time" heatmap. */
export const LIVE_WINDOWS = ["30m", "60m", "all"] as const;
export type LiveWindow = (typeof LIVE_WINDOWS)[number];
export const LIVE_WINDOW_LABELS: Record<LiveWindow, string> = {
  "30m": "Últimos 30 minutos",
  "60m": "Última hora",
  all: "Toda la actividad",
};

export type HelpType = (typeof HELP_EVENT_TYPES)[number];

/** Help the student asked for (buttons), as opposed to replies or reformulations. */
export const HELP_REQUEST_TYPES = ["hint_requested", "clarification_requested", "example_requested"] as const;

export interface LiveParticipant {
  sessionId: string;
  studentId: string;
  studentName: string;
  status: "in_progress" | "completed";
  liveStatus: LiveStatus;
  lastSignalAt: string;
  currentStage: Stage | "done";
  /** Stage the student got to (for a work the teacher ended: where it was ended). */
  reachedStage: Stage;
  /** Completed steps out of `stepsTotal` (2 when the activity has no initial answer). */
  progressSteps: number;
  stepsTotal: 2 | 3;
  stageDurations: Record<Stage, number>;
  /** Time with observed work: gaps between actions count up to 5 minutes each. */
  workMs: number;
  helpCounts: Record<HelpType, number>;
  helpRequests: number;
  hintCount: number;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  endedByTeacher: boolean;
  /**
   * Entered by typing a name that was already on the classroom list (not with a resume code).
   * Usually the student themselves; if not, the teacher can delete this work (F-07).
   */
  enteredWithRosterName: boolean;
  resumeCode: string;
  openAlerts: number;
  immediateAlerts: number;
  supportReasons: string[];
  needsSupport: boolean;
  lastTutorQuestion: string | null;
}

export interface LiveAlert {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  alertKey: string;
  name: string;
  category: string;
  severity: "review" | "immediate";
  source: string;
  /** "observed" = recorded by the browser (paste, leaving the app); "ai" = inferred by the AI from the text. */
  origin: "ai" | "observed";
  evidence: string;
  reason: string;
  status: AlertStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface HeatmapRow {
  sessionId: string;
  studentName: string;
  values: number[];
}

export interface Heatmap {
  columns: { key: string; label: string }[];
  rows: HeatmapRow[];
}

export interface LiveSnapshot {
  /** The teacher's role in the classroom ("owner" unless it was shared with them): what they can change. */
  role: ClassroomRole;
  activity: {
    id: string;
    title: string;
    classroomId: string;
    status: string;
    /** "Aceptar alumnos" (Compartir): when false nobody can join or keep writing. */
    linkActive: boolean;
    requireInitialAnswer: boolean;
  };
  generatedAt: string;
  window: LiveWindow;
  totals: {
    joined: number;
    activeNow: number;
    idle: number;
    abandoned: number;
    completed: number;
    needSupport: number;
    openAlerts: number;
  };
  participants: LiveParticipant[];
  alerts: LiveAlert[];
  heatmaps: {
    /** Counts per student and help/participation type; `totals` is the group row. */
    help: Heatmap & { totals: number[] };
    /** Student work events per time bucket; column keys are bucket start ISO dates. */
    timeline: Heatmap & { start: string; end: string; bucketMs: number };
    /** Milliseconds per stage (and total). */
    stages: Heatmap;
  };
}

// Client-safe rules for the teacher's live view: who is active, which stage each student
// is in, how long each stage took, and the counts behind the heatmaps. Only observed
// events and timestamps are used — nothing here is an AI inference.

export const ACTIVE_WINDOW_MS = 2 * 60_000;
export const ABANDONED_AFTER_MS = 15 * 60_000;

export type LiveStatus = "active" | "idle" | "abandoned" | "completed";

/**
 * The only vocabulary for a student's work state, used by the live cards, the filters, the
 * work page and the lists: Activo / Sin actividad / Abandonada / Terminó.
 */
export const LIVE_STATUS_LABELS: Record<LiveStatus, string> = {
  active: "Activo",
  idle: "Sin actividad",
  abandoned: "Abandonada",
  completed: "Terminó",
};

/** What each state means (the live legend and the tooltips say the same). */
export const LIVE_STATUS_HELP: Record<LiveStatus, string> = {
  active: "Hizo algo en los últimos 2 minutos.",
  idle: "No hace nada hace entre 2 y 15 minutos.",
  abandoned: "No hace nada hace más de 15 minutos y no terminó.",
  completed: "Envió su trabajo, o lo terminaste vos.",
};

export interface LiveEvent {
  eventType: string;
  createdAt: string;
  /** `createdAt` in epoch ms, when the caller already has it (saves re-parsing the ISO string). */
  at?: number;
}

const timeOf = (e: LiveEvent): number => e.at ?? new Date(e.createdAt).getTime();

export interface LiveSession {
  status: string;
  initialAnswer: string | null;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  /** The activity may skip the initial answer (teacher setting). */
  requireInitialAnswer?: boolean;
}

/** Events that are NOT the student working (leaving the tab, pasting, teacher actions). */
export const NON_WORK_EVENTS = new Set(["left_app", "pasted_text", "ended_by_teacher", "session_resumed"]);

export function lastSignalAt(session: LiveSession, events: LiveEvent[]): number {
  let t = Math.max(new Date(session.lastActivityAt).getTime(), new Date(session.startedAt).getTime());
  for (const e of events) if (!NON_WORK_EVENTS.has(e.eventType)) t = Math.max(t, timeOf(e));
  return t;
}

export function liveStatus(session: LiveSession, lastSignal: number, now: number): LiveStatus {
  if (session.status === "completed") return "completed";
  const idle = now - lastSignal;
  if (idle < ACTIVE_WINDOW_MS) return "active";
  if (idle < ABANDONED_AFTER_MS) return "idle";
  return "abandoned";
}

export type Stage = "initial" | "tutor" | "closing";
export const STAGES: Stage[] = ["initial", "tutor", "closing"];
export const STAGE_LABELS: Record<Stage, string> = {
  initial: "Respuesta inicial",
  tutor: "Charla con el tutor",
  closing: "Respuesta final y reflexión",
};

const firstAt = (events: LiveEvent[], type: string) => {
  const e = events.find((x) => x.eventType === type);
  return e ? timeOf(e) : null;
};
const lastAt = (events: LiveEvent[], type: string) => {
  let t: number | null = null;
  for (const e of events) if (e.eventType === type) t = timeOf(e);
  return t;
};

/** Stage the student is currently in ("done" once finished). */
export function currentStage(session: LiveSession, events: LiveEvent[]): Stage | "done" {
  if (session.status === "completed") return "done";
  if (!session.initialAnswer && session.requireInitialAnswer !== false) return "initial";
  const closing = lastAt(events, "closing_started");
  const lastTutor = Math.max(lastAt(events, "message_sent") ?? 0, ...HELP_EVENT_TYPES.map((t) => lastAt(events, t) ?? 0));
  if (closing && closing >= lastTutor) return "closing";
  return "tutor";
}

/** Stages the activity really has (no initial answer when the teacher turned it off). */
export function stagesOf(requireInitialAnswer: boolean): Stage[] {
  return requireInitialAnswer ? STAGES : STAGES.filter((s) => s !== "initial");
}

/**
 * Stage the student got to, even when the work is finished: for a work the teacher ended,
 * this is where the student was when it was ended ("closing" for a work the student sent).
 */
export function stageReached(session: LiveSession, events: LiveEvent[], endedByTeacher = false): Stage {
  if (session.status === "completed" && !endedByTeacher) return "closing";
  const st = currentStage({ ...session, status: "in_progress" }, events);
  return st === "done" ? "closing" : st;
}

/** 1-based position of a stage among the activity's stages ("Etapa 2 de 3", like the student's "Paso 2 de 3"). */
export function stageNumber(stage: Stage, requireInitialAnswer: boolean): number {
  return Math.max(1, stagesOf(requireInitialAnswer).indexOf(stage) + 1);
}

/** Completed steps out of 3 (initial answer, tutor conversation, final + reflection). */
export function progressSteps(session: LiveSession, events: LiveEvent[]): number {
  if (session.status === "completed") return 3;
  if (!session.initialAnswer && session.requireInitialAnswer !== false) return 0;
  return currentStage(session, events) === "closing" ? 2 : 1;
}

/** Milliseconds spent in each stage, from observed timestamps. Ongoing stages count until `until`. */
export function stageDurations(session: LiveSession, events: LiveEvent[], until: number): Record<Stage, number> {
  const start = new Date(session.startedAt).getTime();
  const end = session.completedAt ? new Date(session.completedAt).getTime() : until;
  const initialDone =
    session.requireInitialAnswer === false ? start : (firstAt(events, "initial_answer_saved") ?? (session.initialAnswer ? start : null));
  const closingStart = firstAt(events, "closing_started");
  const finalAt = firstAt(events, "final_answer_saved") ?? (session.completedAt ? end : null);

  const span = (a: number | null, b: number | null) => (a !== null && b !== null && b > a ? b - a : 0);
  const initial = span(start, initialDone ?? end);
  const tutorEnd = closingStart ?? finalAt ?? (initialDone ? end : null);
  const tutor = initialDone ? span(initialDone, tutorEnd) : 0;
  const closing = closingStart ? span(closingStart, finalAt ?? end) : 0;
  return { initial, tutor, closing };
}

export const HELP_EVENT_TYPES = [
  "message_sent",
  "hint_requested",
  "clarification_requested",
  "example_requested",
  "review_requested",
  "alternative_idea",
  "explanation_offered",
] as const;

export const HELP_EVENT_SHORT: Record<(typeof HELP_EVENT_TYPES)[number], string> = {
  message_sent: "Mensajes escritos",
  hint_requested: "Pistas",
  clarification_requested: "No entendí",
  example_requested: "Ejemplos",
  review_requested: "Revisar",
  alternative_idea: "Otra idea",
  explanation_offered: "Explicó",
};

export function helpCounts(events: LiveEvent[]): Record<(typeof HELP_EVENT_TYPES)[number], number> {
  const out = Object.fromEntries(HELP_EVENT_TYPES.map((t) => [t, 0])) as Record<(typeof HELP_EVENT_TYPES)[number], number>;
  for (const e of events) if (e.eventType in out) out[e.eventType as (typeof HELP_EVENT_TYPES)[number]]++;
  return out;
}

/** Student intents that are help requests (buttons) and the ones that carry the student's own reformulation. */
export const HELP_INTENTS = ["hint", "not_understood", "example"] as const;
export const REFORMULATION_INTENTS = ["review", "other_idea", "explain"] as const;

/**
 * One definition of "messages" for the live heatmap, the work page and the PDF:
 * - written: what the student typed (or dictated) without a button — the heatmap's "Mensajes escritos"
 *   (each one is a `message_sent` event);
 * - help: "Necesito una pista", "No entendí", "¿Podés darme un ejemplo?";
 * - reformulations: "Quiero revisar mi respuesta", "Tengo otra idea", "Quiero explicar lo que aprendí".
 */
export function studentMessageCounts(messages: { role: string; intent: string | null; isPartial?: boolean }[]): {
  written: number;
  help: number;
  reformulations: number;
} {
  let written = 0;
  let help = 0;
  let reformulations = 0;
  for (const m of messages) {
    if (m.role !== "user" || m.isPartial) continue;
    if (m.intent && (HELP_INTENTS as readonly string[]).includes(m.intent)) help++;
    else if (m.intent && (REFORMULATION_INTENTS as readonly string[]).includes(m.intent)) reformulations++;
    else written++;
  }
  return { written, help, reformulations };
}

/** Number of events in each of `count` equal time buckets between start and end. */
export function activityBuckets(events: LiveEvent[], start: number, end: number, count: number): number[] {
  const buckets = new Array<number>(count).fill(0);
  if (end <= start || count <= 0) return buckets;
  const size = (end - start) / count;
  for (const e of events) {
    const t = timeOf(e);
    if (t < start || t > end) continue;
    buckets[Math.min(count - 1, Math.floor((t - start) / size))]!++;
  }
  return buckets;
}

/** 0..5 intensity for heatmap colouring, relative to the max of the grid. */
export function intensity(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((value / max) * 5)));
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return ms <= 0 ? "0 min" : "< 1 min";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

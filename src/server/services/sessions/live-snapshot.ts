// Snapshot of the live view of one activity. Participants are the activity's learning
// sessions only. Everything is fetched in bulk (sessions, events, alerts, last tutor turn)
// and computed in memory with the shared live-monitor rules — no per-student queries.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import {
  HELP_EVENT_SHORT,
  HELP_EVENT_TYPES,
  STAGES,
  STAGE_LABELS,
  activityBuckets,
  currentStage,
  helpCounts,
  lastSignalAt,
  liveStatus,
  stageDurations,
  type LiveEvent,
  type LiveSession,
  type Stage,
} from "@shared/domain/live-monitor";
import { supportReasons } from "@shared/domain/access-rules";
import { tutorQuestion } from "@shared/domain/thinking-xray";
import { alertOrigin, progressFor, stepsFor, workTime } from "./live-rules";
import {
  HELP_REQUEST_TYPES,
  type AlertStatus,
  type Heatmap,
  type LiveAlert,
  type LiveParticipant,
  type LiveSnapshot,
  type LiveWindow,
} from "@shared/contracts/live";

type Activity = typeof schema.activities.$inferSelect;

/** Events that are not the student working: excluded from "activity over time". */
const NOT_STUDENT_WORK = new Set(["session_entered", "left_app", "pasted_text", "ended_by_teacher", "session_resumed", "activity_completed"]);
/** A student who just joined is not "needing support" for not having written yet. */
const INITIAL_ANSWER_GRACE_MS = 5 * 60_000;

const WINDOWS: Record<LiveWindow, { ms: number | null; buckets: number }> = {
  "30m": { ms: 30 * 60_000, buckets: 15 },
  "60m": { ms: 60 * 60_000, buckets: 20 },
  all: { ms: null, buckets: 24 },
};

export async function liveSnapshot(activity: Activity, window: LiveWindow, nowMs = Date.now()): Promise<LiveSnapshot> {
  const requireInitialAnswer = activity.requireInitialAnswer;
  const sessions = await db
    .select({ s: schema.learningSessions, studentName: schema.students.fullName })
    .from(schema.learningSessions)
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .where(eq(schema.learningSessions.activityId, activity.id));

  const ids = sessions.map((r) => r.s.id);
  const [events, alertRows, alertCounts, lastTutor] = ids.length
    ? await Promise.all([
        db
          .select({
            sessionId: schema.pedagogicalEvents.sessionId,
            eventType: schema.pedagogicalEvents.eventType,
            createdAt: schema.pedagogicalEvents.createdAt,
          })
          .from(schema.pedagogicalEvents)
          .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, schema.pedagogicalEvents.sessionId))
          .where(eq(schema.learningSessions.activityId, activity.id))
          .orderBy(asc(schema.pedagogicalEvents.createdAt)),
        db
          .select({ a: schema.studentAlerts, studentId: schema.students.id, studentName: schema.students.fullName })
          .from(schema.studentAlerts)
          .innerJoin(schema.learningSessions, eq(schema.learningSessions.id, schema.studentAlerts.sessionId))
          .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
          .where(eq(schema.studentAlerts.activityId, activity.id))
          .orderBy(
            sql`case when "student_alerts"."status" = 'open' then 0 else 1 end`,
            sql`case when "student_alerts"."severity" = 'immediate' then 0 else 1 end`,
            desc(schema.studentAlerts.createdAt),
          )
          .limit(200),
        db
          .select({
            sessionId: schema.studentAlerts.sessionId,
            open: sql<number>`count(*)::int`,
            immediate: sql<number>`count(*) filter (where "student_alerts"."severity" = 'immediate')::int`,
          })
          .from(schema.studentAlerts)
          .where(and(eq(schema.studentAlerts.activityId, activity.id), eq(schema.studentAlerts.status, "open")))
          .groupBy(schema.studentAlerts.sessionId),
        db
          .selectDistinctOn([schema.messages.sessionId], { sessionId: schema.messages.sessionId, content: schema.messages.content })
          .from(schema.messages)
          .where(and(inArray(schema.messages.sessionId, ids), eq(schema.messages.role, "assistant"), eq(schema.messages.isPartial, false)))
          .orderBy(schema.messages.sessionId, desc(schema.messages.createdAt)),
      ])
    : [[], [], [], []];

  const eventsBySession = new Map<string, LiveEvent[]>();
  for (const e of events) {
    const list = eventsBySession.get(e.sessionId) ?? [];
    list.push({ eventType: e.eventType, createdAt: e.createdAt.toISOString() });
    eventsBySession.set(e.sessionId, list);
  }
  const countsBySession = new Map(alertCounts.map((r) => [r.sessionId, r]));
  const questionBySession = new Map(lastTutor.map((r) => [r.sessionId, tutorQuestion(r.content)]));

  const participants: LiveParticipant[] = sessions.map(({ s, studentName }) => {
    const evs = eventsBySession.get(s.id) ?? [];
    const live: LiveSession = {
      status: s.status,
      initialAnswer: s.initialAnswer,
      startedAt: s.startedAt.toISOString(),
      lastActivityAt: s.lastActivityAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      requireInitialAnswer,
    };
    const signal = lastSignalAt(live, evs);
    const status = liveStatus(live, signal, nowMs);
    // Ongoing stages count until the last observed signal (or now, while the student is active).
    const until = status === "active" ? nowMs : signal;
    const counts = helpCounts(evs);
    const hintCount = Math.max(s.hintCount, counts.hint_requested);
    const alerts = countsBySession.get(s.id);
    let reasons = supportReasons({
      hintCount,
      clarificationCount: counts.clarification_requested,
      status: s.status,
      initialAnswer: s.initialAnswer,
      requireInitialAnswer,
    });
    if (nowMs - s.startedAt.getTime() < INITIAL_ANSWER_GRACE_MS) reasons = reasons.filter((r) => !r.includes("respuesta inicial"));
    const workPoints = [
      s.startedAt.getTime(),
      ...evs.filter((e) => !NOT_STUDENT_WORK.has(e.eventType)).map((e) => new Date(e.createdAt).getTime()),
      ...(s.completedAt ? [s.completedAt.getTime()] : []),
    ];
    const openAlerts = alerts?.open ?? 0;
    return {
      sessionId: s.id,
      studentId: s.studentId,
      studentName,
      status: s.status === "completed" ? "completed" : "in_progress",
      liveStatus: status,
      lastSignalAt: new Date(signal).toISOString(),
      currentStage: currentStage(live, evs),
      progressSteps: progressFor(live, evs, requireInitialAnswer),
      stepsTotal: stepsFor(requireInitialAnswer),
      stageDurations: stageDurations(live, evs, until),
      workMs: workTime(workPoints),
      helpCounts: counts,
      helpRequests: HELP_REQUEST_TYPES.reduce((n, t) => n + counts[t], 0),
      hintCount,
      startedAt: live.startedAt,
      lastActivityAt: live.lastActivityAt,
      completedAt: live.completedAt,
      endedByTeacher: s.endedByTeacher,
      resumeCode: s.resumeCode,
      openAlerts,
      immediateAlerts: alerts?.immediate ?? 0,
      supportReasons: reasons,
      needsSupport: openAlerts > 0 || (s.status !== "completed" && reasons.length > 0),
      lastTutorQuestion: questionBySession.get(s.id) ?? null,
    };
  });
  participants.sort((a, b) => a.studentName.localeCompare(b.studentName, "es", { sensitivity: "base" }));

  const alerts: LiveAlert[] = alertRows.map(({ a, studentId, studentName }) => ({
    id: a.id,
    sessionId: a.sessionId,
    studentId,
    studentName,
    alertKey: a.alertKey,
    name: a.name,
    category: a.category,
    severity: a.severity === "immediate" ? "immediate" : "review",
    source: a.source,
    origin: alertOrigin(a.alertKey),
    evidence: a.evidence,
    reason: a.reason,
    status: a.status as AlertStatus,
    createdAt: a.createdAt.toISOString(),
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
  }));

  // ── Heatmaps ──
  const helpColumns = HELP_EVENT_TYPES.map((t) => ({ key: t, label: HELP_EVENT_SHORT[t] }));
  const helpRows = participants.map((p) => ({ sessionId: p.sessionId, studentName: p.studentName, values: HELP_EVENT_TYPES.map((t) => p.helpCounts[t]) }));
  const help: Heatmap & { totals: number[] } = {
    columns: helpColumns,
    rows: helpRows,
    totals: HELP_EVENT_TYPES.map((_, i) => helpRows.reduce((n, r) => n + r.values[i]!, 0)),
  };

  const w = WINDOWS[window];
  // "Toda la actividad" ends now while someone is working, or when the last student finished.
  const lastEnd = participants.reduce(
    (m, p) => Math.max(m, new Date(p.lastSignalAt).getTime(), p.completedAt ? new Date(p.completedAt).getTime() : 0),
    0,
  );
  const anyOpen = participants.some((p) => p.status === "in_progress");
  const end = w.ms === null && !anyOpen && lastEnd > 0 ? Math.min(nowMs, lastEnd) : nowMs;
  const firstStart = participants.reduce((m, p) => Math.min(m, new Date(p.startedAt).getTime()), Number.POSITIVE_INFINITY);
  const start = w.ms !== null ? end - w.ms : Number.isFinite(firstStart) ? Math.min(firstStart, end - 60_000) : end - 60 * 60_000;
  const bucketMs = (end - start) / w.buckets;
  const timeline: LiveSnapshot["heatmaps"]["timeline"] = {
    columns: Array.from({ length: w.buckets }, (_, i) => {
      const at = new Date(start + i * bucketMs).toISOString();
      return { key: at, label: at };
    }),
    rows: participants.map((p) => ({
      sessionId: p.sessionId,
      studentName: p.studentName,
      values: activityBuckets(
        (eventsBySession.get(p.sessionId) ?? []).filter((e) => !NOT_STUDENT_WORK.has(e.eventType)),
        start,
        end,
        w.buckets,
      ),
    })),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    bucketMs,
  };

  const stageKeys: Stage[] = requireInitialAnswer ? STAGES : STAGES.filter((s) => s !== "initial");
  const stages: Heatmap = {
    columns: [...stageKeys.map((k) => ({ key: k, label: STAGE_LABELS[k] })), { key: "total", label: "Total" }],
    rows: participants.map((p) => {
      const values = stageKeys.map((k) => p.stageDurations[k]);
      return { sessionId: p.sessionId, studentName: p.studentName, values: [...values, values.reduce((a, b) => a + b, 0)] };
    }),
  };

  const totals = {
    joined: participants.length,
    activeNow: participants.filter((p) => p.liveStatus === "active").length,
    idle: participants.filter((p) => p.liveStatus === "idle").length,
    abandoned: participants.filter((p) => p.liveStatus === "abandoned").length,
    completed: participants.filter((p) => p.status === "completed").length,
    needSupport: participants.filter((p) => p.needsSupport).length,
    openAlerts: participants.reduce((n, p) => n + p.openAlerts, 0),
  };

  return {
    activity: {
      id: activity.id,
      title: activity.title,
      classroomId: activity.classroomId,
      status: activity.status,
      requireInitialAnswer,
    },
    generatedAt: new Date(nowMs).toISOString(),
    window,
    totals,
    participants,
    alerts,
    heatmaps: { help, timeline, stages },
  };
}

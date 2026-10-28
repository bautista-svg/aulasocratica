// Snapshot of the live view of one activity. Participants are the activity's learning
// sessions only. Everything is fetched in bulk (sessions, events, alerts, last tutor turn)
// and computed in memory with the shared live-monitor rules — no per-student queries.
import { divisionCounts, sanitizeDivisionOptions } from "@shared/domain/divisions";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  stageReached,
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
import type { ClassroomRole } from "@shared/domain/sharing";

type Activity = typeof schema.activities.$inferSelect;

/** Events that are not the student working: excluded from "activity over time". */
const NOT_STUDENT_WORK = new Set(["session_entered", "left_app", "pasted_text", "ended_by_teacher", "session_resumed", "activity_completed"]);
/** A student who just joined is not "needing support" for not having written yet. */
const INITIAL_ANSWER_GRACE_MS = 5 * 60_000;

/** Same order as localeCompare(…, "es", { sensitivity: "base" }), without building a collator per comparison. */
const byName = new Intl.Collator("es", { sensitivity: "base" });

const WINDOWS: Record<LiveWindow, { ms: number | null; buckets: number }> = {
  "30m": { ms: 30 * 60_000, buckets: 15 },
  "60m": { ms: 60 * 60_000, buckets: 20 },
  all: { ms: null, buckets: 24 },
};

export async function liveSnapshot(activity: Activity, window: LiveWindow, role: ClassroomRole, nowMs = Date.now()): Promise<LiveSnapshot> {
  const requireInitialAnswer = activity.requireInitialAnswer;
  const ls = schema.learningSessions;
  const sessionsQuery = db
    .select({
      // Only what the live view uses (not the final answer or the reflection texts).
      s: {
        id: ls.id,
        studentId: ls.studentId,
        status: ls.status,
        initialAnswer: ls.initialAnswer,
        hintCount: ls.hintCount,
        resumeCode: ls.resumeCode,
        endedByTeacher: ls.endedByTeacher,
        startedAt: ls.startedAt,
        lastActivityAt: ls.lastActivityAt,
        completedAt: ls.completedAt,
      },
      studentName: schema.students.fullName,
      division: schema.students.division,
    })
    .from(ls)
    .innerJoin(schema.students, eq(schema.students.id, ls.studentId))
    .where(eq(ls.activityId, activity.id));
  const [sessions, [room]] = await Promise.all([
    sessionsQuery,
    db.select({ divisionOptions: schema.classrooms.divisionOptions }).from(schema.classrooms).where(eq(schema.classrooms.id, activity.classroomId)).limit(1),
  ]);

  const ids = sessions.map((r) => r.s.id);
  const [events, alertRows, alertCounts, lastTutor] = ids.length
    ? await Promise.all([
        // Every event of the activity (≈40 per student): read as plain rows with the time in epoch
        // ms (the same value Drizzle's Date would hold) instead of mapping a Date object per row.
        db
          .execute<{ session_id: string; event_type: string; at: number; from_roster: boolean }>(
            sql`select e.session_id, e.event_type, floor(extract(epoch from e.created_at) * 1000)::float8 as at,
                       coalesce((e.details->>'fromRoster')::boolean, false) as from_roster
                from pedagogical_events e
                join learning_sessions ls on ls.id = e.session_id
                where ls.activity_id = ${activity.id}
                order by e.created_at asc`,
          )
          .then((rows) => Array.from(rows)),
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
  const rosterEntries = new Set<string>();
  for (const e of events) {
    let list = eventsBySession.get(e.session_id);
    if (!list) eventsBySession.set(e.session_id, (list = []));
    const at = Number(e.at);
    list.push({ eventType: e.event_type, createdAt: new Date(at).toISOString(), at });
    // Only this flag of the details (never student content): set on "session_entered" by the student module.
    if (e.event_type === "session_entered" && e.from_roster) rosterEntries.add(e.session_id);
  }
  const countsBySession = new Map(alertCounts.map((r) => [r.sessionId, r]));
  const questionBySession = new Map(lastTutor.map((r) => [r.sessionId, tutorQuestion(r.content)]));

  const participants: LiveParticipant[] = sessions.map(({ s, studentName, division }) => {
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
      ...evs.filter((e) => !NOT_STUDENT_WORK.has(e.eventType)).map((e) => e.at!),
      ...(s.completedAt ? [s.completedAt.getTime()] : []),
    ];
    const openAlerts = alerts?.open ?? 0;
    return {
      sessionId: s.id,
      studentId: s.studentId,
      studentName,
      division,
      status: s.status === "completed" ? "completed" : "in_progress",
      liveStatus: status,
      lastSignalAt: new Date(signal).toISOString(),
      currentStage: currentStage(live, evs),
      reachedStage: stageReached(live, evs, s.endedByTeacher),
      progressSteps: progressFor(live, evs, requireInitialAnswer, s.endedByTeacher),
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
      enteredWithRosterName: rosterEntries.has(s.id),
      resumeCode: s.resumeCode,
      openAlerts,
      immediateAlerts: alerts?.immediate ?? 0,
      supportReasons: reasons,
      needsSupport: openAlerts > 0 || (s.status !== "completed" && reasons.length > 0),
      lastTutorQuestion: questionBySession.get(s.id) ?? null,
    };
  });
  participants.sort((a, b) => byName.compare(a.studentName, b.studentName));

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
    role,
    activity: {
      id: activity.id,
      title: activity.title,
      classroomId: activity.classroomId,
      status: activity.status,
      linkActive: activity.linkActive,
      requireInitialAnswer,
    },
    generatedAt: new Date(nowMs).toISOString(),
    window,
    totals,
    divisions: divisionCounts(
      sanitizeDivisionOptions(room?.divisionOptions),
      participants.map((p) => p.division),
    ),
    participants,
    alerts,
    heatmaps: { help, timeline, stages },
  };
}

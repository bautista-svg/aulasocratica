// Full view of one student's work in one activity, built from observed data plus the
// stored (teacher-reviewed) AI suggestions.
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/client";
import {
  DEFAULT_REFLECTION_QUESTIONS,
  readReflection,
  sanitizeReflectionQuestions,
  sanitizeRubric,
  type ReflectionAnswer,
  type RubricCriterion,
} from "@shared/domain/activity-design";
import { REFLECTION_QUESTIONS } from "@shared/domain/pedagogy";
import { currentStage, lastSignalAt, liveStatus, stageReached, type LiveSession } from "@shared/domain/live-monitor";
import { observedAlertReason } from "@shared/domain/alerts";
import { buildThinkingFlow } from "@shared/domain/thinking-xray";
import { sanitizeSummary, splitObjectives, type SummaryBasis } from "@shared/domain/session-summary";
import { classroomLabel } from "@shared/contracts/classrooms";
import type {
  DeliverableAnalysis,
  ObservedSignals,
  RubricAssessmentView,
  RubricSuggestionItem,
  SessionAlert,
  SessionDeliverableView,
  SessionDetail,
  SessionEvent,
  SessionMessage,
  SummaryView,
  XrayView,
} from "@shared/contracts/sessions";
import type { AlertStatus } from "@shared/contracts/live";
import type { FileKind, ProcessingStatus } from "@shared/domain/files";
import { isDeliverableMode } from "@shared/domain/deliverables";
import { alertOrigin, progressFor, stepsFor } from "./live-rules";
import { readXrayItems, visibleXray } from "./xray-store";

export type OwnedSessionRow = {
  session: typeof schema.learningSessions.$inferSelect;
  activity: typeof schema.activities.$inferSelect;
  student: typeof schema.students.$inferSelect;
};

/** Question texts used to read reflections stored with the legacy keyed format. */
export function reflectionOf(session: { reflection: unknown }, activityQuestions: unknown): ReflectionAnswer[] {
  const legacy = [...sanitizeReflectionQuestions(activityQuestions), ...DEFAULT_REFLECTION_QUESTIONS, ...REFLECTION_QUESTIONS];
  const seen = new Set<string>();
  return readReflection(
    session.reflection,
    legacy.filter((q) => (seen.has(q.key) ? false : (seen.add(q.key), true))),
  );
}

export function toLiveSession(s: OwnedSessionRow["session"], requireInitialAnswer: boolean): LiveSession {
  return {
    status: s.status,
    initialAnswer: s.initialAnswer,
    startedAt: s.startedAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    requireInitialAnswer,
  };
}

/** Only numeric/boolean details are exposed (e.g. pasted characters, time away). */
function safeDetails(details: unknown): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
      if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") out[k.slice(0, 40)] = v;
    }
  }
  return out;
}

export function observedSignals(events: SessionEvent[]): ObservedSignals {
  const pastes = events.filter((e) => e.eventType === "pasted_text");
  const aways = events.filter((e) => e.eventType === "left_app");
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const pasted = {
    count: pastes.length,
    chars: pastes.reduce((n, e) => n + num(e.details.chars), 0),
    fromMaterial: pastes.some((e) => e.details.from_material === true),
  };
  const leftApp = {
    count: aways.length,
    totalMs: aways.reduce((n, e) => n + num(e.details.away_ms), 0),
    longestMs: aways.reduce((m, e) => Math.max(m, num(e.details.away_ms)), 0),
  };
  const summary: string[] = [];
  if (pastes.length) {
    summary.push(
      observedAlertReason(
        "pasted_text",
        pastes.map((e) => ({ chars: num(e.details.chars), from_material: e.details.from_material === true })),
      ),
    );
  }
  if (aways.length) summary.push(observedAlertReason("left_app", aways.map((e) => ({ away_ms: num(e.details.away_ms) }))));
  return { pasted, leftApp, summary };
}

export function readSuggestion(raw: unknown): RubricSuggestionItem[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { criteria?: unknown }).criteria) ? (raw as { criteria: unknown[] }).criteria : null;
  if (!list) return null;
  const out: RubricSuggestionItem[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.criterionId !== "string") continue;
    out.push({
      criterionId: o.criterionId,
      levelIndex: typeof o.levelIndex === "number" && Number.isInteger(o.levelIndex) && o.levelIndex >= 0 ? o.levelIndex : null,
      evidence: typeof o.evidence === "string" ? o.evidence : "",
      rationale: typeof o.rationale === "string" ? o.rationale : "",
      evidenceDropped: o.evidenceDropped === true,
    });
  }
  return out;
}

export function readLevels(raw: unknown, rubric: RubricCriterion[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const c of rubric) {
    const v = (raw as Record<string, unknown>)[c.id];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < c.levels.length) out[c.id] = v;
  }
  return out;
}

export function rubricView(
  row: typeof schema.rubricAssessments.$inferSelect | undefined,
  activityRubric: RubricCriterion[],
): RubricAssessmentView {
  if (!row) {
    return {
      rubric: activityRubric,
      rubricChanged: false,
      suggestion: null,
      aiGeneratedAt: null,
      teacherLevels: {},
      comment: "",
      status: "none",
      confirmedAt: null,
    };
  }
  const snapshot = sanitizeRubric(row.rubricSnapshot);
  const rubric = snapshot.length ? snapshot : activityRubric;
  return {
    rubric,
    rubricChanged: snapshot.length > 0 && JSON.stringify(snapshot) !== JSON.stringify(activityRubric),
    suggestion: readSuggestion(row.aiSuggestion),
    aiGeneratedAt: row.aiGeneratedAt?.toISOString() ?? null,
    teacherLevels: readLevels(row.teacherLevels, rubric),
    comment: row.teacherComment,
    status: row.status === "confirmed" ? "confirmed" : "draft",
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}

export function summaryView(row: typeof schema.sessionSummaries.$inferSelect | undefined): SummaryView | null {
  if (!row) return null;
  const meta = ((row.content as { meta?: Record<string, unknown> } | null)?.meta ?? {}) as Record<string, unknown>;
  return {
    basis: row.basis.filter((b): b is SummaryBasis => b === "rubric" || b === "objectives"),
    content: sanitizeSummary(row.content),
    generatedAt: row.updatedAt.toISOString(),
    droppedQuotes: typeof meta.droppedQuotes === "number" ? meta.droppedQuotes : 0,
    omittedMessages: typeof meta.omittedMessages === "number" ? meta.omittedMessages : 0,
  };
}

export function xrayView(row: typeof schema.thinkingAnalyses.$inferSelect | undefined): XrayView {
  const items = readXrayItems(row?.items);
  return {
    items: visibleXray(items),
    discardedCount: items.filter((i) => i.status === "discarded").length,
    aiGeneratedAt: row?.aiGeneratedAt?.toISOString() ?? null,
  };
}

export async function loadMessages(sessionId: string): Promise<SessionMessage[]> {
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId)).orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
  return rows.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    intent: m.intent,
    inputMode: m.inputMode === "voice" ? "voice" : "text",
    isPartial: m.isPartial,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function loadEvents(sessionId: string): Promise<SessionEvent[]> {
  const rows = await db
    .select()
    .from(schema.pedagogicalEvents)
    .where(eq(schema.pedagogicalEvents.sessionId, sessionId))
    .orderBy(asc(schema.pedagogicalEvents.createdAt));
  return rows.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    source: e.source === "inferred" ? "inferred" : "observed",
    createdAt: e.createdAt.toISOString(),
    details: safeDetails(e.details),
  }));
}

/** The delivered file as the teacher sees it (the analysis is stored as written by ai.ts). */
export function deliverableView(row: typeof schema.sessionDeliverables.$inferSelect | undefined | null): SessionDeliverableView | null {
  if (!row) return null;
  const a = row.analysis as Omit<DeliverableAnalysis, "generatedAt"> | null;
  return {
    fileName: row.fileName,
    kind: row.kind as FileKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    uploadedAt: row.updatedAt.toISOString(),
    processingStatus: row.processingStatus as ProcessingStatus,
    processingError: row.processingError,
    textChars: row.extractedText.length,
    url: `/api/sessions/${row.sessionId}/deliverable/file`,
    analysis:
      a && Array.isArray(a.criteria) && row.analyzedAt
        ? {
            rubric: sanitizeRubric(a.rubric),
            criteria: a.criteria,
            overview: a.overview ?? "",
            strengths: a.strengths ?? "",
            improvements: a.improvements ?? "",
            generatedAt: row.analyzedAt.toISOString(),
          }
        : null,
  };
}

export async function loadSessionDetail(row: OwnedSessionRow): Promise<SessionDetail> {
  const { session: s, activity: a, student } = row;
  const [classroomRows, messages, events, alertRows, rubricRows, summaryRows, xrayRows, deliverableRows] = await Promise.all([
    db.select().from(schema.classrooms).where(eq(schema.classrooms.id, a.classroomId)).limit(1),
    loadMessages(s.id),
    loadEvents(s.id),
    db.select().from(schema.studentAlerts).where(eq(schema.studentAlerts.sessionId, s.id)).orderBy(desc(schema.studentAlerts.createdAt)),
    db.select().from(schema.rubricAssessments).where(eq(schema.rubricAssessments.sessionId, s.id)).limit(1),
    db.select().from(schema.sessionSummaries).where(eq(schema.sessionSummaries.sessionId, s.id)).limit(1),
    db.select().from(schema.thinkingAnalyses).where(eq(schema.thinkingAnalyses.sessionId, s.id)).limit(1),
    db.select().from(schema.sessionDeliverables).where(eq(schema.sessionDeliverables.sessionId, s.id)).limit(1),
  ]);
  const classroom = classroomRows[0]!;
  const rubric = sanitizeRubric(a.rubric);
  const live = toLiveSession(s, a.requireInitialAnswer);
  const liveEvents = events.map((e) => ({ eventType: e.eventType, createdAt: e.createdAt }));
  const signal = lastSignalAt(live, liveEvents);
  const finished = messages.filter((m) => !m.isPartial);
  const alerts: SessionAlert[] = alertRows.map((r) => ({
    id: r.id,
    alertKey: r.alertKey,
    name: r.name,
    category: r.category,
    severity: r.severity === "immediate" ? "immediate" : "review",
    source: r.source,
    origin: alertOrigin(r.alertKey),
    evidence: r.evidence,
    reason: r.reason,
    status: r.status as AlertStatus,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
  }));

  return {
    session: {
      id: s.id,
      status: s.status === "completed" ? "completed" : "in_progress",
      initialAnswer: s.initialAnswer,
      finalAnswer: s.finalAnswer,
      reflection: reflectionOf(s, a.reflectionQuestions),
      hintCount: Math.max(s.hintCount, events.filter((e) => e.eventType === "hint_requested").length),
      resumeCode: s.resumeCode,
      endedByTeacher: s.endedByTeacher,
      startedAt: live.startedAt,
      lastActivityAt: live.lastActivityAt,
      completedAt: live.completedAt,
      liveStatus: liveStatus(live, signal, Date.now()),
      lastSignalAt: new Date(signal).toISOString(),
      currentStage: currentStage(live, liveEvents),
      reachedStage: stageReached(live, liveEvents, s.endedByTeacher),
      progressSteps: progressFor(live, liveEvents, a.requireInitialAnswer, s.endedByTeacher),
      stepsTotal: stepsFor(a.requireInitialAnswer),
    },
    student: { id: student.id, fullName: student.fullName },
    classroom: { id: classroom.id, name: classroom.name, label: classroomLabel(classroom) },
    activity: {
      id: a.id,
      title: a.title,
      instructions: a.instructions,
      objectives: a.objectives,
      requireInitialAnswer: a.requireInitialAnswer,
      status: a.status,
      rubric,
      reflectionQuestions: sanitizeReflectionQuestions(a.reflectionQuestions),
      deliverableMode: isDeliverableMode(a.deliverableMode) ? a.deliverableMode : "off",
      deliverablePrompt: a.deliverablePrompt,
    },
    messages,
    deliverable: deliverableView(deliverableRows[0]),
    events,
    alerts,
    rubric: rubricView(rubricRows[0], rubric),
    summary: summaryView(summaryRows[0]),
    summaryAvailable: { rubric: rubric.length > 0, objectives: splitObjectives(a.objectives).length > 0 },
    xray: xrayView(xrayRows[0]),
    flow: buildThinkingFlow(finished.map((m) => ({ role: m.role, content: m.content, intent: m.intent, createdAt: m.createdAt }))),
    signals: observedSignals(events),
  };
}

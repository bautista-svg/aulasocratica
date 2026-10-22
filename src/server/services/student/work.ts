// The student's own work: initial answer, closing, final answer + reflection, and the
// integrity signals reported by the browser. Every write is atomic on the session row
// (no read-then-update races) and is followed by publish() for the teacher's live view.
// last_activity_at only moves with real work, never with signals or page loads.
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { HttpError, badRequest } from "../../lib/errors";
import { MIN_ANSWER_CHARS } from "@shared/contracts/student-limits";
import { hit } from "../../lib/rate-limit";
import { publish } from "../../lib/events";
import { normalizeForMatch } from "@shared/domain/thinking-xray";
import type { ReflectionAnswer } from "@shared/domain/activity-design";
import type { SignalInput } from "@shared/contracts/student";
import {
  isReadOnly,
  readOnlyError,
  recordEvent,
  reflectionQuestionsOf,
  refreshSession,
  type StudentCtx,
} from "./session";
import { detectAlerts, recordObservedSignal } from "./alerts";
import { runInBackground } from "./background";
import { consignasOf, joinFinalAnswers } from "@shared/domain/consignas";

export const SIGNAL_LIMIT = { perSession: 40, windowMs: 10 * 60_000 };

const editable = (sessionId: string) =>
  and(
    eq(schema.learningSessions.id, sessionId),
    eq(schema.learningSessions.status, "in_progress"),
    eq(schema.learningSessions.endedByTeacher, false),
  );

export async function saveInitialAnswer(ctx: StudentCtx, answer: string): Promise<StudentCtx> {
  if (isReadOnly(ctx.session)) throw readOnlyError(ctx.session);
  const [row] = await db
    .update(schema.learningSessions)
    .set({ initialAnswer: answer, lastActivityAt: new Date() })
    .where(and(editable(ctx.session.id), isNull(schema.learningSessions.initialAnswer)))
    .returning({ id: schema.learningSessions.id });
  const next = await refreshSession(ctx);
  if (!row) {
    // Saved before (double tap, another tab) → idempotent; closed meanwhile → read-only.
    if (isReadOnly(next.session)) throw readOnlyError(next.session);
    return next;
  }
  await recordEvent(ctx.session.id, "initial_answer_saved", { length: answer.length });
  publish(ctx.activity.id, "session", ctx.session.id);
  runInBackground("alerts_initial", () =>
    detectAlerts({
      sessionId: ctx.session.id,
      activityId: ctx.activity.id,
      classroomId: ctx.activity.classroomId,
      teacherId: ctx.activity.teacherId,
      text: answer,
      source: "initial_answer",
    }),
  );
  return next;
}

/** The student opened the closing step (every time: the live view shows the stage). */
export async function startClosing(ctx: StudentCtx): Promise<void> {
  if (isReadOnly(ctx.session)) throw readOnlyError(ctx.session);
  if (ctx.activity.requireInitialAnswer && !ctx.session.initialAnswer) {
    throw new HttpError(409, "Primero escribí tu respuesta inicial.", "initial_required");
  }
  const [row] = await db
    .update(schema.learningSessions)
    .set({ lastActivityAt: new Date() })
    .where(editable(ctx.session.id))
    .returning({ id: schema.learningSessions.id });
  if (!row) throw readOnlyError((await refreshSession(ctx)).session);
  await recordEvent(ctx.session.id, "closing_started");
  publish(ctx.activity.id, "session", ctx.session.id);
}

export async function finishActivity(
  ctx: StudentCtx,
  input: { finalAnswer: string; finalAnswers?: string[]; reflection: { key: string; answer: string }[] },
): Promise<StudentCtx> {
  if (ctx.session.endedByTeacher) throw readOnlyError(ctx.session);
  if (ctx.session.status === "completed") return ctx; // idempotent (double tap)
  if (ctx.activity.requireInitialAnswer && !ctx.session.initialAnswer) {
    throw new HttpError(409, "Primero escribí tu respuesta inicial.", "initial_required");
  }
  if (ctx.activity.deliverableMode === "required") {
    const [file] = await db
      .select({ id: schema.sessionDeliverables.id })
      .from(schema.sessionDeliverables)
      .where(eq(schema.sessionDeliverables.sessionId, ctx.session.id))
      .limit(1);
    if (!file) throw new HttpError(409, "Subí tu archivo antes de enviar tu trabajo.", "deliverable_required");
  }
  // Several consignas: one answer each; finalAnswer keeps them joined for everything that reads it.
  const consignas = consignasOf(ctx.activity);
  let finalAnswer: string | null = input.finalAnswer.trim();
  let finalAnswers: string[] = [];
  if (!ctx.activity.askFinalAnswer) {
    finalAnswer = null;
  } else if (consignas.length > 1) {
    const given = input.finalAnswers ?? [];
    const fields: Record<string, string> = {};
    consignas.forEach((_, i) => {
      if ((given[i] ?? "").trim().length < MIN_ANSWER_CHARS) fields[`finalAnswers.${i}`] = "Escribí tu respuesta a esta consigna.";
    });
    if (Object.keys(fields).length) throw badRequest("Respondé cada consigna antes de enviar tu trabajo.", fields);
    finalAnswers = consignas.map((_, i) => given[i]!.trim());
    finalAnswer = joinFinalAnswers(finalAnswers);
  } else if (finalAnswer.length < MIN_ANSWER_CHARS) {
    throw badRequest("Escribí tu respuesta final.", { finalAnswer: "Escribí tu respuesta final." });
  }
  const questions = reflectionQuestionsOf(ctx.activity);
  const byKey = new Map(input.reflection.map((r) => [r.key, r.answer.trim()]));
  const reflection: ReflectionAnswer[] = questions.map((q) => ({ key: q.key, question: q.question, answer: byKey.get(q.key) ?? "" }));
  const now = new Date();
  const [row] = await db
    .update(schema.learningSessions)
    .set({
      finalAnswer,
      finalAnswers,
      reflection,
      status: "completed",
      completedAt: now,
      lastActivityAt: now,
    })
    .where(editable(ctx.session.id))
    .returning({ id: schema.learningSessions.id });
  const next = await refreshSession(ctx);
  if (!row) {
    if (next.session.endedByTeacher) throw readOnlyError(next.session);
    return next;
  }

  const answered = reflection.filter((r) => r.answer).length;
  if (finalAnswer !== null) {
    await recordEvent(ctx.session.id, "final_answer_saved", { length: finalAnswer.length, ...(finalAnswers.length ? { consignas: finalAnswers.length } : {}) });
  }
  const initial = ctx.session.initialAnswer;
  if (initial && finalAnswer !== null && normalizeForMatch(initial) !== normalizeForMatch(finalAnswer)) {
    await recordEvent(ctx.session.id, "reformulated");
  }
  if (answered > 0) await recordEvent(ctx.session.id, "reflection_submitted", { answered, questions: reflection.length });
  await recordEvent(ctx.session.id, "activity_completed");
  publish(ctx.activity.id, "session", ctx.session.id);

  const text = [finalAnswer ?? "", ...reflection.filter((r) => r.answer).map((r) => r.answer)].filter(Boolean).join("\n\n");
  runInBackground("alerts_final", () =>
    detectAlerts({
      sessionId: ctx.session.id,
      activityId: ctx.activity.id,
      classroomId: ctx.activity.classroomId,
      teacherId: ctx.activity.teacherId,
      text,
      source: "final_answer",
    }),
  );
  return next;
}

/** Browser-observed signal. Ignored (not an error) once the work is closed. */
export async function reportSignal(ctx: StudentCtx, signal: SignalInput & { fromMaterial?: boolean }): Promise<boolean> {
  if (isReadOnly(ctx.session)) return false;
  if (!hit(`s_signal:${ctx.session.id}`, SIGNAL_LIMIT.perSession, SIGNAL_LIMIT.windowMs)) {
    throw new HttpError(429, "Demasiadas señales seguidas.", "rate_limited");
  }
  const target = { sessionId: ctx.session.id, activityId: ctx.activity.id, classroomId: ctx.activity.classroomId };
  if (signal.kind === "pasted_text") {
    await recordObservedSignal(target, { kind: "pasted_text", chars: signal.chars, fromMaterial: signal.fromMaterial ?? false });
  } else {
    await recordObservedSignal(target, { kind: "left_app", awayMs: signal.awayMs, fromMaterial: signal.fromMaterial ?? false });
  }
  return true;
}

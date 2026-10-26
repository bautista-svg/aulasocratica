// The student's own work: initial answer, closing, final answer + reflection, and the
// integrity signals reported by the browser. Every write is atomic on the session row
// (no read-then-update races) and is followed by publish() for the teacher's live view.
// last_activity_at only moves with real work, never with signals or page loads.
import { and, eq, isNull, sql } from "drizzle-orm";
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
  readConsignaAnswers,
  readOnlyError,
  recordEvent,
  reflectionQuestionsOf,
  refreshSession,
  type StudentCtx,
} from "./session";
import { detectAlerts, recordObservedSignal } from "./alerts";
import { runInBackground } from "./background";
import { asksFinalProduction, structuredConsignas } from "@shared/domain/structure";
import { languageOf } from "@shared/domain/language";

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

/** One consigna's answer, saved as the student types (editable until the work is sent). */
export async function saveConsignaAnswer(ctx: StudentCtx, consignaId: string, text: string): Promise<void> {
  if (isReadOnly(ctx.session)) throw readOnlyError(ctx.session);
  if (ctx.session.status === "completed") throw new HttpError(409, "Ya enviaste tu trabajo.", "completed");
  if (!structuredConsignas(ctx.activity).some((c) => c.id === consignaId)) throw badRequest("Esa consigna ya no está en la actividad.");
  const patch = JSON.stringify({ [consignaId]: text.replace(/\r\n/g, "\n") });
  const [row] = await db
    .update(schema.learningSessions)
    .set({ consignaAnswers: sql`${schema.learningSessions.consignaAnswers} || ${patch}::jsonb`, lastActivityAt: new Date() })
    .where(editable(ctx.session.id))
    .returning({ id: schema.learningSessions.id });
  if (!row) throw new HttpError(409, "Ya enviaste tu trabajo.", "completed");
  publish(ctx.activity.id, "session", ctx.session.id);
}

export async function finishActivity(
  ctx: StudentCtx,
  input: { finalAnswer: string; finalAnswers?: string[]; consignaAnswers?: Record<string, string>; reflection: { key: string; answer: string }[] },
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
  // The answers written in each consigna (saved while typing; the latest ones come with this
  // request too) plus the final production. finalAnswer keeps everything joined, with the
  // consigna it answers, for whatever reads the final answer (AI analyses, reports, live view).
  const consignas = structuredConsignas(ctx.activity);
  const lang = languageOf(ctx.activity.language);
  const given: Record<string, string> = { ...readConsignaAnswers(ctx.session.consignaAnswers), ...(input.consignaAnswers ?? {}) };
  // Older screens sent one answer per consigna at the end, by position.
  (input.finalAnswers ?? []).forEach((a, i) => {
    const c = consignas[i];
    if (c && a.trim() && !(given[c.id] ?? "").trim()) given[c.id] = a;
  });
  const asked = consignas.filter((c) => c.answer);
  const fields: Record<string, string> = {};
  for (const c of asked) {
    if ((given[c.id] ?? "").trim().length < MIN_ANSWER_CHARS) fields[`consigna.${c.id}`] = "Escribí tu respuesta a esta consigna.";
  }
  if (Object.keys(fields).length) throw badRequest("Respondé cada consigna antes de enviar tu trabajo.", fields);
  const production = input.finalAnswer.trim();
  const asksProduction = asksFinalProduction(ctx.activity);
  if (asksProduction && production.length < MIN_ANSWER_CHARS) {
    throw badRequest("Escribí tu respuesta final.", { finalAnswer: "Escribí tu respuesta final." });
  }
  // Every reflection question needs an answer: the work is not sent with one left blank.
  const questions = reflectionQuestionsOf(ctx.activity);
  const byKey = new Map(input.reflection.map((r) => [r.key, r.answer.trim()]));
  const reflection: ReflectionAnswer[] = questions.map((q) => ({ key: q.key, question: q.question, answer: byKey.get(q.key) ?? "" }));
  const blank = Object.fromEntries(reflection.flatMap((r, i) => (r.answer ? [] : [[`reflection.${i}.answer`, "Respondé esta pregunta."]])));
  if (Object.keys(blank).length) throw badRequest("Respondé todas las preguntas de tu reflexión antes de enviar tu trabajo.", blank);
  const finalAnswers = consignas.map((c) => (c.answer ? (given[c.id] ?? "").trim() : ""));
  const answersText =
    asked.length === 1 && consignas.length === 1
      ? finalAnswers[0]!
      : asked.map((c) => `Consigna ${consignas.indexOf(c) + 1}${c.title.trim() ? ` (${c.title.trim()})` : ""}:\n${(given[c.id] ?? "").trim()}`).join("\n\n");
  let finalAnswer: string | null = null;
  if (asksProduction) finalAnswer = answersText ? `${answersText}\n\n${lang === "en" ? "Final work" : "Producción final"}:\n${production}` : production;
  else if (answersText) finalAnswer = answersText;
  const now = new Date();
  const [row] = await db
    .update(schema.learningSessions)
    .set({
      finalAnswer,
      finalAnswers: asked.length ? finalAnswers : [],
      consignaAnswers: given,
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
    await recordEvent(ctx.session.id, "final_answer_saved", { length: finalAnswer.length, ...(asked.length ? { consignas: asked.length } : {}) });
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

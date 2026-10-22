// The Socratic tutor engine: stores the student's message, rebuilds the conversation from
// the database (never from the client), builds the cached system prompt and streams Claude's
// reply to the student as Server-Sent Events. While it streams, the reply is mirrored to a
// partial `messages` row so the teacher's live view shows it word by word; it is finalized
// at the end. If the student disconnects, generation continues and the reply is saved, so the
// conversation stays consistent with what the model will see next turn.
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { anthropic, aiError, assertBudget, recordUsage, wellFormed, MODEL, type UsageContext } from "../../ai/client";
import { env } from "../../env";
import { HttpError } from "../../lib/errors";
import { ACTIVITY_LIMITS } from "@shared/contracts/activities";
import { hit } from "../../lib/rate-limit";
import { publish } from "../../lib/events";
import { log, errorFields } from "../../lib/logger";
import { STUDENT_INTENTS, sanitizeExtraTutorTypes } from "@shared/domain/pedagogy";
import { KIND_LABEL, type FileKind } from "@shared/domain/files";
import { isVoiceLanguage } from "@shared/domain/voice";
import { buildHistory, buildTutorPrompt, conversationQuery, tutorRequest } from "@shared/domain/tutor-prompt";
import type { MaterialSource } from "@shared/domain/material-select";
import type { chatBody } from "@shared/contracts/student";
import type { z } from "zod";
import { isReadOnly, readOnlyError, recordEvent, type StudentCtx } from "./session";
import { acquireStream, releaseStream } from "./streams";
import { detectAlerts } from "./alerts";
import { runInBackground } from "./background";
import { sanitizeMoreInstructions } from "@shared/domain/consignas";
import { intentMessages, languageOf } from "@shared/domain/language";

export const CHAT_LIMIT = { perSession: 20, windowMs: 5 * 60_000 };
export const HISTORY_LIMIT = 40;
const FLUSH_EVERY_MS = 700;
export const TUTOR_MAX_TOKENS = 1500;

/** Calm, generic reply when the model declines (stop_reason "refusal"). */
export const REFUSAL_REPLY =
  "Prefiero no seguir por ese lado. Volvamos a la actividad: ¿qué parte de la consigna te gustaría pensar ahora?";
const EMPTY_REPLY = "Perdón, no me salió una respuesta. ¿Me contás de nuevo qué estás pensando?";
const REPLIES_EN = {
  refusal: "I'd rather not go down that road. Let's get back to the activity: which part of the task would you like to think about now?",
  empty: "Sorry, I couldn't come up with an answer. Could you tell me again what you're thinking?",
};

type ChatBody = z.infer<typeof chatBody>;

export async function materialSources(activityId: string): Promise<MaterialSource[]> {
  const files = await db
    .select({
      fileName: schema.activityFiles.fileName,
      kind: schema.activityFiles.kind,
      extractedText: schema.activityFiles.extractedText,
      teacherNote: schema.activityFiles.teacherNote,
    })
    .from(schema.activityFiles)
    .where(and(eq(schema.activityFiles.activityId, activityId), eq(schema.activityFiles.processingStatus, "ready")))
    .orderBy(asc(schema.activityFiles.createdAt));
  return files.map((f) => ({
    name: f.fileName,
    kind: KIND_LABEL[f.kind as FileKind] ?? "archivo",
    text: [f.extractedText.trim(), f.teacherNote.trim() ? `[Nota del docente sobre este archivo]\n${f.teacherNote.trim()}` : ""]
      .filter(Boolean)
      .join("\n\n"),
  }));
}

/** Validates, stores the student's message and returns the SSE response with the reply. */
export async function tutorChat(c: Context, ctx: StudentCtx, body: ChatBody): Promise<Response> {
  const { activity, session } = ctx;
  if (isReadOnly(session)) throw readOnlyError(session);
  if (activity.requireInitialAnswer && !session.initialAnswer) {
    throw new HttpError(409, "Primero escribí tu respuesta inicial.", "initial_required");
  }
  if (!acquireStream(session.id)) {
    throw new HttpError(409, "El tutor todavía está respondiendo tu mensaje anterior.", "busy");
  }
  let handedOff = false;
  try {
    if (!hit(`s_chat:${session.id}`, CHAT_LIMIT.perSession, CHAT_LIMIT.windowMs)) {
      throw new HttpError(429, "Mandaste muchos mensajes seguidos. Tomate un momento para pensar y seguí en un minuto.", "rate_limited");
    }
    await assertBudget(activity.teacherId);
    // Per-student daily cap: one student can never use up the whole class's budget.
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.sessionId, session.id),
          eq(schema.messages.role, "assistant"),
          sql`${schema.messages.createdAt} > now() - interval '24 hours'`,
        ),
      );
    if ((today?.n ?? 0) >= env.AI_DAILY_REPLIES_PER_STUDENT) {
      throw new HttpError(429, "Llegaste al máximo de mensajes con el tutor por hoy en esta actividad. Avisale a tu docente.", "student_quota");
    }
    anthropic(); // 503 before storing anything when the AI is not configured

    let userMessageId: string | null = null;
    let userText = "";
    if (body.retry) {
      const [last] = await db
        .select({ role: schema.messages.role })
        .from(schema.messages)
        .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, false)))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(1);
      if (!last || last.role !== "user") throw new HttpError(409, "No hay un mensaje tuyo esperando respuesta.", "nothing_to_retry");
    } else {
      userText = body.text;
      const [msg] = await db
        .insert(schema.messages)
        .values({ sessionId: session.id, role: "user", content: body.text, intent: body.intent, inputMode: body.inputMode })
        .returning({ id: schema.messages.id });
      userMessageId = msg!.id;
      await db
        .update(schema.learningSessions)
        .set({
          hintCount: body.intent === "hint" ? sql`${schema.learningSessions.hintCount} + 1` : undefined,
          lastActivityAt: new Date(),
        })
        .where(eq(schema.learningSessions.id, session.id));
      await recordEvent(session.id, body.intent ? STUDENT_INTENTS[body.intent].event : "message_sent", {}, userMessageId);
      if (body.inputMode === "voice" && activity.voiceLanguage !== "off") {
        await recordEvent(session.id, "voice_message", { language: activity.voiceLanguage }, userMessageId);
      }
      publish(activity.id, "message", session.id);
    }

    // Interrupted replies from a crashed process never reach the model or the teacher view.
    await db.delete(schema.messages).where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, true)));

    const [rows, files, fresh] = await Promise.all([
      db
        .select({ role: schema.messages.role, content: schema.messages.content })
        .from(schema.messages)
        .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, false)))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(HISTORY_LIMIT),
      materialSources(activity.id),
      db
        .select({ hintCount: schema.learningSessions.hintCount, initialAnswer: schema.learningSessions.initialAnswer })
        .from(schema.learningSessions)
        .where(eq(schema.learningSessions.id, session.id))
        .limit(1),
    ]);
    const history = buildHistory(rows.reverse());
    if (history.length === 0 || history[history.length - 1]!.role !== "user") {
      throw new HttpError(409, "No hay un mensaje tuyo esperando respuesta.", "nothing_to_retry");
    }
    const state = fresh[0] ?? { hintCount: session.hintCount, initialAnswer: session.initialAnswer };
    const prompt = buildTutorPrompt({
      title: activity.title,
      subject: activity.subject,
      objectives: activity.objectives,
      instructions: activity.instructions,
      moreInstructions: sanitizeMoreInstructions(activity.moreInstructions, ACTIVITY_LIMITS.instructions),
      askFinalAnswer: activity.askFinalAnswer,
      language: languageOf(activity.language),
      material: activity.material,
      files,
      tutorType: activity.tutorType,
      extraTutorTypes: sanitizeExtraTutorTypes(activity.extraTutorTypes, activity.tutorType),
      helpLevel: activity.helpLevel,
      teacherRules: activity.tutorRules,
      voiceLanguage: isVoiceLanguage(activity.voiceLanguage) ? activity.voiceLanguage : "off",
      requireInitialAnswer: activity.requireInitialAnswer,
      initialAnswer: state.initialAnswer,
      hintCount: state.hintCount,
      recentConversation: conversationQuery(history, state.initialAnswer, activity.instructions),
    });
    const { system, messages } = tutorRequest(prompt, history);

    const presetOnly = body.intent !== null && intentMessages(body.intent).includes(userText.trim());
    const detectAfter =
      userMessageId && !presetOnly
        ? {
            sessionId: session.id,
            activityId: activity.id,
            classroomId: activity.classroomId,
            teacherId: activity.teacherId,
            text: userText,
            messageId: userMessageId,
            source: "chat" as const,
          }
        : null;

    handedOff = true;
    return streamReply(c, ctx, { system, messages, userMessageId, detectAfter });
  } finally {
    if (!handedOff) releaseStream(session.id);
  }
}

function streamReply(
  c: Context,
  ctx: StudentCtx,
  opts: {
    system: Anthropic.TextBlockParam[];
    messages: Anthropic.MessageParam[];
    userMessageId: string | null;
    detectAfter: Parameters<typeof detectAlerts>[0] | null;
  },
): Response {
  const { activity, session } = ctx;
  const usageCtx: UsageContext = { purpose: "tutor_chat", teacherId: activity.teacherId, activityId: activity.id };
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (sse) => {
    const send = async (event: string, data: unknown) => {
      if (sse.aborted || sse.closed) return;
      try {
        await sse.writeSSE({ event, data: JSON.stringify(data) });
      } catch {
        /* client went away: keep generating and save the reply */
      }
    };

    // Partial row mirrored for the teacher's live view; writes are chained so they land in order.
    const draft = { id: null as string | null, text: "", lastFlush: 0, chain: Promise.resolve() as Promise<unknown> };
    const flush = () => {
      const snapshot = draft.text;
      draft.chain = draft.chain
        .then(async () => {
          if (!draft.id) {
            const [row] = await db
              .insert(schema.messages)
              .values({ sessionId: session.id, role: "assistant", content: snapshot, isPartial: true })
              .returning({ id: schema.messages.id });
            draft.id = row!.id;
          } else {
            await db.update(schema.messages).set({ content: snapshot }).where(eq(schema.messages.id, draft.id));
          }
          publish(activity.id, "message", session.id);
        })
        .catch((err) => log.warn("tutor_draft_write_failed", { sessionId: session.id, ...errorFields(err) }));
    };

    try {
      await send("start", { userMessageId: opts.userMessageId });
      let final: Anthropic.Message;
      try {
        const stream = anthropic().messages.stream({
          model: MODEL,
          max_tokens: TUTOR_MAX_TOKENS,
          thinking: { type: "disabled" },
          output_config: { effort: "low" },
          system: wellFormed(opts.system),
          messages: wellFormed(opts.messages),
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            draft.text += event.delta.text;
            await send("delta", { text: event.delta.text });
            if (Date.now() - draft.lastFlush >= FLUSH_EVERY_MS) {
              draft.lastFlush = Date.now();
              flush();
            }
          }
        }
        final = await stream.finalMessage();
      } catch (err) {
        await recordUsage(usageCtx, null, false);
        await draft.chain;
        if (draft.id) await db.delete(schema.messages).where(eq(schema.messages.id, draft.id));
        publish(activity.id, "message", session.id);
        const e = aiError(err, usageCtx);
        await send("error", { message: e.message, code: e.code });
        return;
      }

      await recordUsage(usageCtx, final.usage, true);
      let text = draft.text.trim();
      if (final.stop_reason === "refusal") {
        log.info("tutor_refusal", { sessionId: session.id, category: final.stop_details?.category ?? null });
        text = languageOf(activity.language) === "en" ? REPLIES_EN.refusal : REFUSAL_REPLY;
      } else if (!text) {
        text = languageOf(activity.language) === "en" ? REPLIES_EN.empty : EMPTY_REPLY;
      }
      await draft.chain;
      let messageId: string;
      if (draft.id) {
        await db.update(schema.messages).set({ content: text, isPartial: false }).where(eq(schema.messages.id, draft.id));
        messageId = draft.id;
      } else {
        const [row] = await db
          .insert(schema.messages)
          .values({ sessionId: session.id, role: "assistant", content: text })
          .returning({ id: schema.messages.id });
        messageId = row!.id;
      }
      publish(activity.id, "message", session.id);
      await send("done", { messageId, text });
    } catch (err) {
      // Database trouble mid-reply: tell the student honestly; their message is saved.
      log.error("tutor_chat_failed", { sessionId: session.id, ...errorFields(err) });
      await draft.chain.catch(() => undefined);
      if (draft.id) await db.delete(schema.messages).where(eq(schema.messages.id, draft.id)).catch(() => undefined);
      await send("error", { message: "No pudimos guardar la respuesta del tutor. Tocá «Reintentar».", code: "internal" });
    } finally {
      releaseStream(session.id);
      if (opts.detectAfter) {
        const input = opts.detectAfter;
        runInBackground("alerts_chat", () => detectAlerts(input));
      }
    }
  });
}

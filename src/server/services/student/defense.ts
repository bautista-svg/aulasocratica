// «Defensa de código», the turn: the AI assesses the last answer and names the next lines; the
// server cuts them from the real code and writes the message, so the fragment on screen is always
// the student's own, word for word. The reply is whole (it has to be checked before it is shown) and
// goes through the same events as the tutor's stream.
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../../db/client";
import { HttpError, badRequest } from "../../lib/errors";
import { generateStructured } from "../../ai/client";
import { publish } from "../../lib/events";
import { log, errorFields } from "../../lib/logger";
import { courseOf } from "../sessions/ai";
import { languageOf } from "@shared/domain/language";
import {
  DEFENSE_FRAGMENTS,
  DEFENSE_MIN_ANSWERS,
  QUESTION_KINDS,
  changeMarkdown,
  cleanCodeFiles,
  cutFragment,
  fragmentMarkdown,
  validChange,
  type CodeFile,
  type CodeFragment,
  type DefenseVerdict,
  type QuestionKind,
} from "@shared/domain/code-defense";
import { defenseSystem } from "@shared/domain/code-defense-prompt";
import { tutorDoneReason } from "@shared/domain/tutor-closing";
import { isReadOnly, readOnlyError, recordEvent, type StudentCtx } from "./session";
import { releaseStream } from "./streams";
import { detectAlerts } from "./alerts";
import { runInBackground } from "./background";
import { defenseCode, saveCode } from "./code";

const HISTORY_MESSAGES = 16;

const turnSchema = z.object({
  assessment: z
    .object({
      verdict: z.enum(["explained", "partial", "not_explained"]),
      reason: z.string(),
      quote: z.string(),
    })
    .nullable(),
  action: z.enum(["ask", "reask", "talk", "finish"]),
  file: z.string(),
  fromLine: z.number().int(),
  toLine: z.number().int(),
  kind: z.enum(QUESTION_KINDS),
  change: z.object({ before: z.string(), after: z.string() }).nullable(),
  lead: z.string(),
  question: z.string(),
});
type Turn = z.infer<typeof turnSchema>;

type Check = typeof schema.codeDefenseChecks.$inferSelect;

const clip = (s: string, n: number) => s.trim().slice(0, n);

const fallbacks = (ctx: StudentCtx) => {
  const en = languageOf(ctx.activity.language) === "en";
  return {
    closing: en ? "Thanks, that's all I wanted to ask you. Tap «Finish» to close the activity." : "Gracias, eso era todo lo que quería preguntarte. Tocá «Terminar» para cerrar la actividad.",
    next: en ? "Let's go on with another part." : "Sigamos con otra parte.",
  };
};

/** What the AI needs to know this turn, and what it already went through. */
function stateText(checks: Check[], mustFinish: boolean, asked: number, cap: number): string {
  const lines = checks.map(
    (c, i) => `${i + 1}. ${c.file}, líneas ${c.fromLine}-${c.toLine} (${c.kind}${c.attempts > 1 ? ", ya tuvo repregunta" : ""}): ${c.verdict ?? "sin evaluar"}`,
  );
  const open = checks.at(-1);
  return [
    "## ESTADO (de la plataforma)",
    lines.length ? `Fragmentos que ya recorriste (no los repitas):\n${lines.join("\n")}` : "Todavía no preguntaste nada: arrancá con el primer fragmento, sin saludo largo.",
    open?.attempts && open.attempts > 1 ? "El último fragmento ya tuvo su repregunta: no uses reask." : "",
    `Llevás ${checks.length} fragmentos de entre ${DEFENSE_FRAGMENTS.min} y ${DEFENSE_FRAGMENTS.max}, y ${asked} mensajes de ${cap}.`,
    mustFinish ? "Ya alcanza: este mensaje es el cierre, con action \"finish\"." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const overlaps = (f: CodeFragment, c: Check) => f.file === c.file && f.fromLine <= c.toLine && c.fromLine <= f.toLine;

/** Why the AI's next step cannot be used as it is, or null when it can. */
function problemWith(turn: Turn, fragment: CodeFragment | null, checks: Check[]): string | null {
  if (turn.action === "talk") return null;
  if (turn.action === "finish") {
    const answered = checks.filter((c) => c.verdict).length + (turn.assessment ? 1 : 0);
    return answered >= DEFENSE_MIN_ANSWERS ? null : "Todavía es temprano para cerrar: preguntá por otra parte del código.";
  }
  if (!fragment) return `Esas líneas no existen (${turn.file}, ${turn.fromLine}-${turn.toLine}). Usá un archivo y líneas reales del código.`;
  if (!turn.question.trim()) return "Falta la pregunta.";
  if (turn.action === "ask" && checks.some((c) => overlaps(fragment, c))) return "Ya preguntaste por esas líneas: elegí otra parte del código.";
  if (turn.kind === "change" && !validChange(fragment, turn.change)) return "En change, before tiene que ser texto exacto del fragmento y after, distinto.";
  return null;
}

async function askAI(ctx: StudentCtx, files: CodeFile[], checks: Check[], mustFinish: boolean, asked: number, cap: number, note = ""): Promise<Turn> {
  const { activity, session } = ctx;
  const rows = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.sessionId, session.id), eq(schema.messages.isPartial, false)))
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(HISTORY_MESSAGES);
  const history = rows
    .reverse()
    .map((m) => `${m.role === "user" ? "ESTUDIANTE" : "VOS"}: ${m.content}`)
    .join("\n\n");
  return generateStructured({
    purpose: "code_defense",
    teacherId: activity.teacherId,
    activityId: activity.id,
    effort: "low",
    maxTokens: 1200,
    system: [
      {
        type: "text",
        text: defenseSystem({
          title: activity.title,
          subject: activity.subject,
          course: await courseOf(activity),
          objectives: activity.objectives,
          instructions: activity.instructions,
          teacherRules: activity.tutorRules,
          language: languageOf(activity.language),
          files,
        }),
        cache_control: { type: "ephemeral" },
      },
    ],
    content: [
      stateText(checks, mustFinish, asked, cap),
      history ? `## CONVERSACIÓN\n${history}` : "",
      note ? `## CORRECCIÓN\nTu respuesta anterior no se pudo usar: ${note}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: turnSchema,
  });
}

/** The student's words since the tutor's last message: their answer to the open fragment. */
async function lastAnswer(sessionId: string): Promise<string> {
  const rows = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.isPartial, false)))
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(6);
  const out: string[] = [];
  for (const m of rows) {
    if (m.role !== "user") break;
    out.unshift(m.content);
  }
  return out.join("\n");
}

async function writeTurn(ctx: StudentCtx, closing: { maxQuestions: number | null; stopWhenAchieved: boolean; asked: number }) {
  const { activity, session, student } = ctx;
  const files = await defenseCode(activity, student.id);
  if (!files.length) throw new HttpError(409, "Primero cargá tu código.", "code_required");
  const checks = await db
    .select()
    .from(schema.codeDefenseChecks)
    .where(eq(schema.codeDefenseChecks.sessionId, session.id))
    .orderBy(asc(schema.codeDefenseChecks.createdAt));
  const cap = closing.maxQuestions ?? 0;
  const lastMessage = closing.asked + 1 >= cap;
  const answered = checks.filter((c) => c.verdict).length;
  const open = checks.at(-1);
  // The answer to the fragment that is open now counts as well: it is about to be assessed.
  const enough = checks.length >= DEFENSE_FRAGMENTS.max && open?.answeredAt == null;
  const mustFinish = lastMessage || enough;

  let turn = await askAI(ctx, files, checks, mustFinish, closing.asked, cap);
  let fragment = cutFragment(files, turn.file, turn.fromLine, turn.toLine);
  const problem = problemWith(turn, fragment, checks);
  if (problem && !mustFinish) {
    turn = await askAI(ctx, files, checks, mustFinish, closing.asked, cap, problem);
    fragment = cutFragment(files, turn.file, turn.fromLine, turn.toLine);
    const again = problemWith(turn, fragment, checks);
    // Twice out of the code: never show something that is not there.
    if (again && !fragment) throw new HttpError(502, "El tutor no pudo elegir una parte de tu código. Probá de nuevo.", "ai_incomplete");
  }

  const answer = closing.asked > 0 ? await lastAnswer(session.id) : "";
  if (open && answer && turn.assessment) {
    await db
      .update(schema.codeDefenseChecks)
      .set({
        answer: open.answer ? `${open.answer}\n\n${clip(answer, 4000)}` : clip(answer, 4000),
        verdict: turn.assessment.verdict satisfies DefenseVerdict,
        reason: clip(turn.assessment.reason, 600),
        quote: clip(turn.assessment.quote, 600),
        answeredAt: new Date(),
      })
      .where(eq(schema.codeDefenseChecks.id, open.id));
  }

  const finish = mustFinish || turn.action === "finish";
  const canClose = finish && (mustFinish || answered + (turn.assessment ? 1 : 0) >= DEFENSE_MIN_ANSWERS);
  const words = fallbacks(ctx);
  let text: string;
  let insertCheck: Omit<typeof schema.codeDefenseChecks.$inferInsert, "sessionId"> | null = null;
  let reasked = false;
  if (canClose) {
    text = clip(turn.lead, 500) || words.closing;
  } else if (turn.action === "talk" || turn.action === "finish" || !fragment) {
    text = [clip(turn.lead, 800) || words.next, clip(turn.question, 300)].filter(Boolean).join("\n\n");
  } else {
    const kind: QuestionKind = turn.kind;
    const change = kind === "change" ? validChange(fragment, turn.change) : null;
    text = [clip(turn.lead, 300), fragmentMarkdown(fragment), change ? changeMarkdown(fragment.file, change) : "", clip(turn.question, 600)].filter(Boolean).join("\n\n");
    reasked = turn.action === "reask" && Boolean(open) && open!.attempts < 2 && overlaps(fragment, open!);
    if (!reasked) {
      insertCheck = { file: fragment.file, fromLine: fragment.fromLine, toLine: fragment.toLine, code: fragment.code, kind, change, question: clip(turn.question, 600) };
    }
  }

  const [saved] = await db.insert(schema.messages).values({ sessionId: session.id, role: "assistant", content: text }).returning({ id: schema.messages.id });
  if (insertCheck) await db.insert(schema.codeDefenseChecks).values({ ...insertCheck, sessionId: session.id, messageId: saved!.id });
  if (reasked) await db.update(schema.codeDefenseChecks).set({ attempts: sql`${schema.codeDefenseChecks.attempts} + 1` }).where(eq(schema.codeDefenseChecks.id, open!.id));

  if (canClose) await db.update(schema.learningSessions).set({ tutorAchievedAt: new Date() }).where(eq(schema.learningSessions.id, session.id));
  await db.update(schema.learningSessions).set({ lastActivityAt: new Date() }).where(eq(schema.learningSessions.id, session.id));
  const tutorDone = tutorDoneReason({ ...closing, asked: closing.asked + 1, achieved: canClose });
  if (tutorDone) await recordEvent(session.id, "tutor_closed", { achieved: tutorDone === "achieved" });
  return { messageId: saved!.id, text, tutorDone };
}

export function streamDefense(
  c: Context,
  ctx: StudentCtx,
  opts: {
    userMessageId: string | null;
    detectAfter: Parameters<typeof detectAlerts>[0] | null;
    closing: { maxQuestions: number | null; stopWhenAchieved: boolean; asked: number };
  },
): Response {
  const { activity, session } = ctx;
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (sse) => {
    const send = async (event: string, data: unknown) => {
      if (sse.aborted || sse.closed) return;
      try {
        await sse.writeSSE({ event, data: JSON.stringify(data) });
      } catch {
        /* client went away: the reply is saved anyway */
      }
    };
    try {
      await send("start", { userMessageId: opts.userMessageId });
      const reply = await writeTurn(ctx, opts.closing);
      publish(activity.id, "message", session.id);
      await send("delta", { text: reply.text });
      await send("done", reply);
    } catch (err) {
      log.warn("code_defense_turn_failed", { sessionId: session.id, ...errorFields(err) });
      if (err instanceof HttpError) await send("error", { message: err.message, code: err.code });
      else await send("error", { message: "No pudimos guardar la respuesta del tutor. Tocá «Reintentar».", code: "internal" });
    } finally {
      releaseStream(session.id);
      if (opts.detectAfter) {
        const input = opts.detectAfter;
        runInBackground("alerts_chat", () => detectAlerts(input));
      }
    }
  });
}

/** The student loads their code. Once the first question was asked, it stays as it is. */
export async function saveStudentCode(ctx: StudentCtx, raw: CodeFile[]) {
  const { activity, session, student } = ctx;
  if (isReadOnly(session)) throw readOnlyError(session);
  const [started] = await db.select({ id: schema.codeDefenseChecks.id }).from(schema.codeDefenseChecks).where(eq(schema.codeDefenseChecks.sessionId, session.id)).limit(1);
  if (started) throw new HttpError(409, "Tu código ya está cargado y empezaste a responder.", "code_locked");
  const { files, error } = cleanCodeFiles(raw);
  if (error) throw badRequest(error);
  await saveCode(activity.id, student.id, files, "student");
  await recordEvent(session.id, "code_uploaded", { files: files.length });
  publish(activity.id, "message", session.id);
}

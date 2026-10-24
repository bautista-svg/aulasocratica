// "Reevaluar habilidades": evaluates every work of an activity again, from scratch, with the
// skills and indicators chosen now. It runs on the server (the teacher can leave the page); the
// new results are written all together only when every work succeeded, so the board never mixes
// old and new evaluations, and a failure keeps the previous ones. One run per activity at a time.
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../../db/client";
import { HttpError, badRequest } from "../../lib/errors";
import { log, errorFields } from "../../lib/logger";
import { evaluateWork, type WorkEvaluation } from "./skills";
import type { OwnedSessionRow } from "./detail";
import type { SkillRunView } from "@shared/contracts/skills";

/** A run that has not finished after this long was interrupted (the server restarted). */
const STALE_MS = 30 * 60_000;
const CONCURRENCY = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Run = typeof schema.skillRuns.$inferSelect;

export function runView(r: Run | undefined): SkillRunView | null {
  if (!r) return null;
  const stale = r.status === "running" && Date.now() - r.startedAt.getTime() > STALE_MS;
  return {
    status: stale ? "failed" : (r.status as SkillRunView["status"]),
    total: r.total,
    done: r.done,
    failed: r.failed,
    error: stale ? "La reevaluación se interrumpió. Volvé a empezarla." : r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

export async function latestRun(activityId: string): Promise<SkillRunView | null> {
  const [r] = await db
    .select()
    .from(schema.skillRuns)
    .where(eq(schema.skillRuns.activityId, activityId))
    .orderBy(sql`${schema.skillRuns.startedAt} desc`)
    .limit(1);
  return runView(r);
}

/** Works to evaluate again: finished ones with something written, and any already evaluated. */
async function worksOf(activityId: string): Promise<OwnedSessionRow[]> {
  return db
    .select({ session: schema.learningSessions, activity: schema.activities, student: schema.students })
    .from(schema.learningSessions)
    .innerJoin(schema.activities, eq(schema.activities.id, schema.learningSessions.activityId))
    .innerJoin(schema.students, eq(schema.students.id, schema.learningSessions.studentId))
    .leftJoin(schema.aspectAnalyses, eq(schema.aspectAnalyses.sessionId, schema.learningSessions.id))
    .where(
      and(
        eq(schema.learningSessions.activityId, activityId),
        sql`(("learning_sessions"."status" = 'completed' and (coalesce("learning_sessions"."initial_answer", '') <> '' or coalesce("learning_sessions"."final_answer", '') <> ''
          or exists (select 1 from "messages" where "messages"."session_id" = "learning_sessions"."id" and "messages"."role" = 'user')))
          or "aspect_analyses"."skills_at" is not null)`,
      ),
    );
}

export async function startReevaluation(activityId: string, teacherId: string): Promise<SkillRunView> {
  // A run left "running" by a restart must not block the activity forever.
  await db
    .update(schema.skillRuns)
    .set({ status: "failed", error: "La reevaluación se interrumpió.", finishedAt: new Date() })
    .where(and(eq(schema.skillRuns.activityId, activityId), eq(schema.skillRuns.status, "running"), lt(schema.skillRuns.startedAt, new Date(Date.now() - STALE_MS))));
  const works = await worksOf(activityId);
  if (works.length === 0) throw badRequest("Todavía no hay trabajos para evaluar en esta actividad.");
  let run: Run;
  try {
    [run] = (await db.insert(schema.skillRuns).values({ activityId, teacherId, total: works.length }).returning()) as [Run];
  } catch {
    // The partial unique index allows one running run per activity.
    throw new HttpError(409, "Ya hay una reevaluación en curso en esta actividad. Esperá a que termine.", "busy");
  }
  void process(run, works, teacherId);
  return runView(run)!;
}

async function process(run: Run, works: OwnedSessionRow[], teacherId: string) {
  const results = new Map<string, WorkEvaluation>();
  let done = 0;
  let failed = 0;
  let firstError = "";
  let next = 0;
  const progress = () =>
    db.update(schema.skillRuns).set({ done, failed }).where(eq(schema.skillRuns.id, run.id)).catch(() => {});

  const worker = async () => {
    while (next < works.length) {
      const row = works[next++]!;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          results.set(row.session.id, await evaluateWork(row, teacherId, { fresh: true }));
          break;
        } catch (err) {
          // A busy AI gets one more try after a pause; anything else fails this work.
          const busy = err instanceof HttpError && (err.status === 429 || err.status === 503);
          if (attempt === 0 && busy) {
            await sleep(15_000);
            continue;
          }
          failed++;
          firstError ||= err instanceof HttpError ? err.message : "No pudimos evaluar uno de los trabajos.";
          log.warn("skill_run_work_failed", { runId: run.id, sessionId: row.session.id, ...errorFields(err) });
          break;
        }
      }
      done++;
      await progress();
    }
  };

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (failed > 0) {
      await db
        .update(schema.skillRuns)
        .set({
          status: "failed",
          done,
          failed,
          error: `${firstError} Se mantienen los resultados anteriores.`,
          finishedAt: new Date(),
        })
        .where(eq(schema.skillRuns.id, run.id));
      return;
    }
    // Everything evaluated: replace all the previous results at once.
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const [sessionId, ev] of results) {
        const values = { skills: ev.skills, recommendations: ev.recommendations, interventions: ev.interventions, skillsAt: now, updatedAt: now };
        await tx
          .insert(schema.aspectAnalyses)
          .values({ sessionId, ...values })
          .onConflictDoUpdate({ target: schema.aspectAnalyses.sessionId, set: values });
      }
      await tx.update(schema.skillRuns).set({ status: "done", done, failed: 0, finishedAt: now }).where(eq(schema.skillRuns.id, run.id));
    });
  } catch (err) {
    log.error("skill_run_failed", { runId: run.id, ...errorFields(err) });
    await db
      .update(schema.skillRuns)
      .set({ status: "failed", error: "No pudimos terminar la reevaluación. Se mantienen los resultados anteriores.", finishedAt: new Date() })
      .where(and(eq(schema.skillRuns.id, run.id), inArray(schema.skillRuns.status, ["running"])))
      .catch(() => {});
  }
}

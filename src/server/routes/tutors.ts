// "Mis tutores": every workspace has the 18 built-in tutors (editable, restorable) plus its own.
import { Hono } from "hono";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { readJson, badRequest, notFound, parseWith } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedTutor } from "../services/access";
import { audit } from "../services/audit";
import { once } from "../services/activities/idempotency";
import { ensurePresetTutors } from "../services/tutors/presets";
import { listTutors, tutorDetail } from "../services/tutors/queries";
import { tutorCreateBody, tutorDuplicateBody, tutorPatch, MAX_CUSTOM_TUTORS } from "@shared/contracts/tutors";
import { matchesPreset, presetValues } from "@shared/domain/tutor-presets";

async function detailOrThrow(teacherId: string, id: string) {
  const d = await tutorDetail(teacherId, id);
  if (!d) throw notFound("El tutor");
  return d;
}

async function assertCustomRoom(teacherId: string) {
  const [n] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tutors)
    .where(and(eq(schema.tutors.teacherId, teacherId), isNull(schema.tutors.presetKey)));
  if ((n?.n ?? 0) >= MAX_CUSTOM_TUTORS) {
    throw badRequest(`Llegaste al máximo de ${MAX_CUSTOM_TUTORS} tutores propios. Borrá alguno que no uses para crear otro.`);
  }
}

export const tutorRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const t = teacherOf(c);
    await ensurePresetTutors(t.id);
    return c.json({ tutors: await listTutors(t.id) });
  })

  .post("/", async (c) => {
    const t = teacherOf(c);
    const { requestId, ...body } = await readJson(c, tutorCreateBody);
    // A double click or a retry with the same request id returns the tutor created the first time.
    const tutor = await once("tutor", t.id, requestId, body, async () => {
      await assertCustomRoom(t.id);
      const [row] = await db
        .insert(schema.tutors)
        .values({ ...body, teacherId: t.id, presetKey: null })
        .returning({ id: schema.tutors.id });
      return detailOrThrow(t.id, row!.id);
    });
    return c.json({ tutor }, 201);
  })

  .get("/:id", async (c) => {
    const t = teacherOf(c);
    await ensurePresetTutors(t.id);
    const row = await ownedTutor(t.id, c.req.param("id"));
    return c.json({ tutor: await detailOrThrow(t.id, row.id) });
  })

  .patch("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedTutor(t.id, c.req.param("id"));
    const body = await readJson(c, tutorPatch);
    if (Object.keys(body).length === 0) return c.json({ tutor: await detailOrThrow(t.id, row.id) });
    const next = { ...row, ...body };
    let updatedAt: Date | ReturnType<typeof sql> | undefined;
    if (row.presetKey) {
      // A preset edited back to its exact original is not "customized" anymore.
      updatedAt = matchesPreset(row.presetKey, next)
        ? row.createdAt
        : sql`greatest(now(), ${schema.tutors.createdAt} + interval '2 seconds')`;
    }
    await db
      .update(schema.tutors)
      .set({ ...body, ...(updatedAt ? { updatedAt } : {}) })
      .where(and(eq(schema.tutors.id, row.id), eq(schema.tutors.teacherId, t.id)));
    return c.json({ tutor: await detailOrThrow(t.id, row.id) });
  })

  .post("/:id/restore", async (c) => {
    const t = teacherOf(c);
    const row = await ownedTutor(t.id, c.req.param("id"));
    const original = row.presetKey ? presetValues(row.presetKey) : null;
    if (!original) throw badRequest("Solo los tutores incluidos se pueden restaurar al original.");
    await db
      .update(schema.tutors)
      .set({ ...original, updatedAt: row.createdAt })
      .where(and(eq(schema.tutors.id, row.id), eq(schema.tutors.teacherId, t.id)));
    return c.json({ tutor: await detailOrThrow(t.id, row.id) });
  })

  .post("/:id/duplicate", async (c) => {
    const t = teacherOf(c);
    const row = await ownedTutor(t.id, c.req.param("id"));
    // The body is optional (older clients send none); with a request id a double click makes one copy.
    const { requestId } = parseWith(tutorDuplicateBody, await c.req.json().catch(() => ({})));
    const tutor = await once(`tutor-duplicate:${row.id}`, t.id, requestId, null, async () => {
      await assertCustomRoom(t.id);
      const name = `${row.name} (copia)`.slice(0, 120);
      const [copy] = await db
        .insert(schema.tutors)
        .values({
          teacherId: t.id,
          presetKey: null,
          name,
          tutorType: row.tutorType,
          subject: row.subject,
          studentAge: row.studentAge,
          objectives: row.objectives,
          questionStyle: row.questionStyle,
          difficulty: row.difficulty,
          helpLevel: row.helpLevel,
          strategies: row.strategies,
          closingCriteria: row.closingCriteria,
          rules: row.rules,
        })
        .returning({ id: schema.tutors.id });
      return detailOrThrow(t.id, copy!.id);
    });
    return c.json({ tutor }, 201);
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedTutor(t.id, c.req.param("id"));
    if (row.presetKey) {
      throw badRequest("Los tutores incluidos no se pueden borrar. Si lo cambiaste, podés restaurarlo al original.");
    }
    // Activities keep the configuration they copied; their tutor_id becomes null (FK set null).
    await db.delete(schema.tutors).where(and(eq(schema.tutors.id, row.id), eq(schema.tutors.teacherId, t.id)));
    await audit(c, t.id, "tutor_deleted", "tutor", row.id);
    return c.json({ ok: true });
  });

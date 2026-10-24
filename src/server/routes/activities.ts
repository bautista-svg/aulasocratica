// Activity editor API: create, edit, files, sharing (link), lifecycle and AI design helpers.
// Every route is teacher-only and resolves the activity through ownedActivity (404 for
// activities of other workspaces).
import { legacyFields, sanitizeConsignas, structuredConsignas } from "@shared/domain/structure";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { badRequest, notFound, readJson, tooMany } from "../lib/errors";
import { assertStorageRoom } from "../services/quota";
import { namesRemoved, reconcileReports, studentsWithWork } from "../services/reports/reconcile";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedActivity, ownedClassroom, ownedTutor } from "../services/access";
import { audit } from "../services/audit";
import { publish } from "../lib/events";
import { hit } from "../lib/rate-limit";
import { fileSize, fileStream } from "../lib/storage";
import { attachmentHeader } from "../lib/pdf";
import { fileOf, listFiles, loadActivity, toFile } from "../services/activities/data";
import { once } from "../services/activities/idempotency";
import {
  createActivity,
  deleteActivity,
  duplicateActivity,
  newLinkToken,
  resetActivity,
  tutorConfig,
} from "../services/activities/lifecycle";
import {
  fileTextPage,
  readFileParts,
  removeActivityFile,
  retryActivityFile,
  saveActivityUploads,
  TEXT_PAGE_DEFAULT,
  TEXT_PAGE_MAX,
} from "../services/activities/files";
import { importRubric, proposeReflection, proposeRubric } from "../services/activities/ai";
import { activitySkills } from "../services/sessions/skills";
import { startReevaluation } from "../services/sessions/skill-runs";
import {
  ACTIVITY_LIMITS,
  activityPatch,
  aiReflectionBody,
  aiRubricBody,
  applyTutorBody,
  createActivityBody,
  deleteActivityBody,
  duplicateBody,
  fileNoteBody,
  linkPatch,
  resetBody,
} from "@shared/contracts/activities";
import { sanitizeReflectionQuestions, sanitizeRubric } from "@shared/domain/activity-design";
import { sanitizeExtraTutorTypes } from "@shared/domain/pedagogy";
import { MAX_CONSIGNAS, sanitizeMoreInstructions } from "@shared/domain/consignas";

/** AI design helpers per workspace: generous for real use, bounded against loops. */
function assertAiRate(teacherId: string) {
  if (!hit(`activity-ai:${teacherId}`, 40, 10 * 60_000)) {
    throw tooMany("Pediste muchas propuestas seguidas. Esperá unos minutos y probá de nuevo.");
  }
}

function assertUploadRate(teacherId: string) {
  if (!hit(`activity-upload:${teacherId}`, 200, 10 * 60_000)) {
    throw tooMany("Subiste muchos archivos seguidos. Esperá unos minutos y probá de nuevo.");
  }
}

async function owned(c: Context<AppEnv>) {
  const t = teacherOf(c);
  const activity = await ownedActivity(t.id, c.req.param("id") ?? "");
  return { t, activity };
}

async function respond(c: Context<AppEnv>, teacherId: string, activityId: string, status: 200 | 201 = 200) {
  return c.json({ activity: await loadActivity(teacherId, activityId) }, status);
}

function setStatus(activityId: string, values: Partial<typeof schema.activities.$inferInsert>) {
  return db.update(schema.activities).set(values).where(eq(schema.activities.id, activityId));
}

export const activityRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  // ── Create & read ──
  .post("/", async (c) => {
    const t = teacherOf(c);
    const { requestId, ...body } = await readJson(c, createActivityBody);
    // A double click or a retry with the same request id returns the activity created the first time.
    const activity = await once("activity", t.id, requestId, body, async () => {
      const room = await ownedClassroom(t.id, body.classroomId);
      const tutor = body.tutorId ? await ownedTutor(t.id, body.tutorId) : null;
      const id = await createActivity({ teacherId: t.id, classroom: room, title: body.title, tutor, language: body.language });
      return loadActivity(t.id, id);
    });
    return c.json({ activity }, 201);
  })

  .get("/:id", async (c) => {
    const { t, activity } = await owned(c);
    return c.json({ activity: await loadActivity(t.id, activity.id), files: await listFiles(activity.id) });
  })

  // "Habilidades" of the group: counts per skill and level, with each student's evidence.
  .get("/:id/skills", async (c) => {
    const { t, activity } = await owned(c);
    return c.json(await activitySkills(activity.id, t.id));
  })

  // "Reevaluar habilidades": every work again, from scratch, replacing the previous results.
  .post("/:id/skills/reevaluate", async (c) => {
    const { t, activity } = await owned(c);
    const run = await startReevaluation(activity.id, t.id);
    await audit(c, t.id, "skills_reevaluation_started", "activity", activity.id, { works: run.total });
    return c.json({ run }, 202);
  })

  // ── Edit ──
  .patch("/:id", async (c) => {
    const { t, activity } = await owned(c);
    const body = await readJson(c, activityPatch);
    const { rubric, reflectionQuestions, extraTutorTypes, moreInstructions, consignas, ...rest } = body;
    const values: Partial<typeof schema.activities.$inferInsert> = { ...rest };
    if (moreInstructions !== undefined) values.moreInstructions = sanitizeMoreInstructions(moreInstructions, ACTIVITY_LIMITS.instructions);
    if (consignas !== undefined) {
      const list = sanitizeConsignas(consignas, ACTIVITY_LIMITS.instructions, MAX_CONSIGNAS);
      Object.assign(values, { consignas: list }, legacyFields(list));
    } else if ((body.instructions !== undefined || moreInstructions !== undefined) && Array.isArray(activity.consignas) && activity.consignas.length) {
      // Written through the old fields (e.g. a script): keep each consigna's title and answer by position.
      const current = structuredConsignas(activity, ACTIVITY_LIMITS.instructions, MAX_CONSIGNAS);
      const texts = [body.instructions ?? activity.instructions, ...((values.moreInstructions as string[] | undefined) ?? sanitizeMoreInstructions(activity.moreInstructions, ACTIVITY_LIMITS.instructions))];
      values.consignas = sanitizeConsignas(
        texts.map((text, i) => ({ id: current[i]?.id ?? `c${i + 1}`, title: current[i]?.title ?? "", text, answer: current[i]?.answer ?? false })),
        ACTIVITY_LIMITS.instructions,
        MAX_CONSIGNAS,
      );
    }
    // The combined types never repeat the main one (also when only the main one changes).
    if (extraTutorTypes !== undefined || body.tutorType !== undefined) {
      values.extraTutorTypes = sanitizeExtraTutorTypes(extraTutorTypes ?? activity.extraTutorTypes, body.tutorType ?? activity.tutorType);
    }
    if (rubric !== undefined) values.rubric = sanitizeRubric(rubric);
    // An empty list stays empty: the teacher decided there is no final reflection.
    if (reflectionQuestions !== undefined) values.reflectionQuestions = sanitizeReflectionQuestions(reflectionQuestions);
    if (Object.keys(values).length) {
      await setStatus(activity.id, values);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/tutor", async (c) => {
    const { t, activity } = await owned(c);
    const { tutorId } = await readJson(c, applyTutorBody);
    const tutor = await ownedTutor(t.id, tutorId);
    await setStatus(activity.id, tutorConfig(tutor));
    publish(activity.id, "activity");
    return respond(c, t.id, activity.id);
  })

  // ── Lifecycle ──
  .post("/:id/publish", async (c) => {
    const { t, activity } = await owned(c);
    if (activity.status === "archived") throw badRequest("Restaurá la actividad antes de publicarla.");
    const [room] = await db
      .select({ archived: schema.classrooms.isArchived })
      .from(schema.classrooms)
      .where(eq(schema.classrooms.id, activity.classroomId));
    if (room?.archived) throw badRequest("El aula está archivada. Restaurala para publicar actividades.");
    const fields: Record<string, string> = {};
    if (!activity.title.trim()) fields.title = "Poné un título.";
    if (!activity.instructions.trim()) fields.instructions = "Escribí la consigna que van a leer tus alumnos.";
    if (Object.keys(fields).length) {
      throw badRequest("Para publicar, la actividad necesita un título y una consigna.", fields);
    }
    if (activity.status !== "published") {
      await setStatus(activity.id, { status: "published", publishedAt: new Date() });
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/unpublish", async (c) => {
    const { t, activity } = await owned(c);
    if (activity.status === "published") {
      await setStatus(activity.id, { status: "draft" });
      await audit(c, t.id, "activity_unpublished", "activity", activity.id);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/archive", async (c) => {
    const { t, activity } = await owned(c);
    if (activity.status !== "archived") {
      await setStatus(activity.id, { status: "archived" });
      await audit(c, t.id, "activity_archived", "activity", activity.id);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  // "Eliminar": to the classroom's "Papelera" (archived, so the link stops; recoverable for 30 days).
  .post("/:id/trash", async (c) => {
    const { t, activity } = await owned(c);
    if (!activity.deletedAt) {
      await setStatus(activity.id, { status: "archived", deletedAt: new Date() });
      await audit(c, t.id, "activity_trashed", "activity", activity.id, { status: activity.status });
      publish(activity.id, "activity");
    }
    return c.json({ ok: true, classroomId: activity.classroomId });
  })

  .post("/:id/untrash", async (c) => {
    const { t, activity } = await owned(c);
    if (activity.deletedAt) {
      // Back as a draft: reopening the link to students is an explicit "Publicar".
      await setStatus(activity.id, { status: "draft", deletedAt: null });
      await audit(c, t.id, "activity_untrashed", "activity", activity.id);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/restore", async (c) => {
    const { t, activity } = await owned(c);
    if (activity.deletedAt) throw badRequest("Esta actividad está en la papelera: restaurala desde ahí.");
    if (activity.status === "archived") {
      // Back as a draft: reopening the link to students is an explicit "Publicar".
      await setStatus(activity.id, { status: "draft" });
      await audit(c, t.id, "activity_restored", "activity", activity.id);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/duplicate", async (c) => {
    const { t, activity } = await owned(c);
    const { requestId, ...body } = await readJson(c, duplicateBody);
    const targetId = body.classroomId ?? activity.classroomId;
    // The same request id (double click, retry) returns the copy made the first time.
    const out = await once(`duplicate:${activity.id}`, t.id, requestId, { targetId }, async () => {
      const room = await ownedClassroom(t.id, targetId);
      if (room.isArchived) throw badRequest("Esa aula está archivada. Elegí otra o restaurala.");
      if (!hit(`duplicate:${t.id}`, 30, 60 * 60_000)) {
        throw tooMany("Duplicaste muchas actividades seguidas. Esperá unos minutos y probá de nuevo.");
      }
      const r = await duplicateActivity(activity, room.id);
      return { activity: await loadActivity(t.id, r.id), copiedFiles: r.copiedFiles, skippedFiles: r.skippedFiles };
    });
    return c.json(out, 201);
  })

  .post("/:id/reset", async (c) => {
    const { t, activity } = await owned(c);
    const body = await readJson(c, resetBody);
    const before = await studentsWithWork(activity.id);
    const r = await resetActivity(activity, { regenerateLink: body.regenerateLink === true });
    await reconcileReports(t.id, await namesRemoved(before));
    await audit(c, t.id, "activity_reset", "activity", activity.id, { ...r.deleted, linkRegenerated: r.linkRegenerated });
    publish(activity.id, "activity");
    return c.json({ ok: true, ...r, activity: await loadActivity(t.id, activity.id) });
  })

  .delete("/:id", async (c) => {
    const { t, activity } = await owned(c);
    await readJson(c, deleteActivityBody);
    const r = await deleteActivity(activity);
    await reconcileReports(t.id);
    await audit(c, t.id, "activity_deleted", "activity", activity.id, r);
    publish(activity.id, "activity");
    return c.json({ ok: true, classroomId: activity.classroomId });
  })

  // ── Link ──
  .patch("/:id/link", async (c) => {
    const { t, activity } = await owned(c);
    const body = await readJson(c, linkPatch);
    const startsAt = body.startsAt !== undefined ? body.startsAt : (activity.startsAt?.toISOString() ?? null);
    const expiresAt = body.expiresAt !== undefined ? body.expiresAt : (activity.expiresAt?.toISOString() ?? null);
    if (startsAt && expiresAt && new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
      throw badRequest("Revisá las fechas.", { expiresAt: "El cierre tiene que ser después de la apertura." });
    }
    const values: Partial<typeof schema.activities.$inferInsert> = {};
    if (body.linkActive !== undefined) values.linkActive = body.linkActive;
    if (body.startsAt !== undefined) values.startsAt = body.startsAt ? new Date(body.startsAt) : null;
    if (body.expiresAt !== undefined) values.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (Object.keys(values).length) {
      await setStatus(activity.id, values);
      publish(activity.id, "activity");
    }
    return respond(c, t.id, activity.id);
  })

  .post("/:id/link/regenerate", async (c) => {
    const { t, activity } = await owned(c);
    await setStatus(activity.id, { linkToken: newLinkToken() });
    await audit(c, t.id, "activity_link_regenerated", "activity", activity.id);
    publish(activity.id, "activity");
    return respond(c, t.id, activity.id);
  })

  // ── Files ──
  .get("/:id/files", async (c) => {
    const { activity } = await owned(c);
    return c.json({ files: await listFiles(activity.id) });
  })

  .post("/:id/files", async (c) => {
    const { t, activity } = await owned(c);
    assertUploadRate(t.id);
    const parts = await readFileParts(c);
    await assertStorageRoom(t.id, parts.reduce((n, f) => n + f.size, 0));
    const r = await saveActivityUploads(activity.id, parts);
    return c.json(r, 201);
  })

  .patch("/:id/files/:fileId", async (c) => {
    const { activity } = await owned(c);
    const f = await fileOf(activity.id, c.req.param("fileId"));
    const { teacherNote } = await readJson(c, fileNoteBody);
    await db.update(schema.activityFiles).set({ teacherNote }).where(eq(schema.activityFiles.id, f.id));
    return c.json({ file: toFile(await fileOf(activity.id, f.id)) });
  })

  .post("/:id/files/:fileId/retry", async (c) => {
    const { activity } = await owned(c);
    const f = await fileOf(activity.id, c.req.param("fileId"));
    if (f.processingStatus === "ready") throw badRequest("Este archivo ya está leído.");
    await retryActivityFile(f.id);
    return c.json({ file: toFile(await fileOf(activity.id, f.id)) });
  })

  .delete("/:id/files/:fileId", async (c) => {
    const { activity } = await owned(c);
    const f = await fileOf(activity.id, c.req.param("fileId"));
    await removeActivityFile(activity.id, f.id, f.storageKey);
    return c.json({ ok: true });
  })

  .get("/:id/files/:fileId/download", async (c) => {
    const { activity } = await owned(c);
    const f = await fileOf(activity.id, c.req.param("fileId"));
    const size = await fileSize(f.storageKey);
    if (size === null) throw notFound("El archivo");
    // Only PDFs and images may open in the browser; everything else downloads.
    const inline = c.req.query("inline") === "1" && (f.kind === "pdf" || f.kind === "image");
    const disposition = attachmentHeader(f.fileName).replace(/^attachment/, inline ? "inline" : "attachment");
    const body = Readable.toWeb(fileStream(f.storageKey)) as unknown as ReadableStream;
    return c.body(body, 200, {
      "Content-Type": f.mimeType,
      "Content-Length": String(size),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
    });
  })

  .get("/:id/files/:fileId/text", async (c) => {
    const { activity } = await owned(c);
    const f = await fileOf(activity.id, c.req.param("fileId"));
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset") ?? 0)) || 0);
    const limit = Math.min(TEXT_PAGE_MAX, Math.max(1, Math.floor(Number(c.req.query("limit") ?? TEXT_PAGE_DEFAULT)) || TEXT_PAGE_DEFAULT));
    return c.json(await fileTextPage(f.id, offset, limit));
  })

  // ── AI design helpers (suggestions only; nothing is saved) ──
  .post("/:id/ai/rubric", async (c) => {
    const { t, activity } = await owned(c);
    const body = await readJson(c, aiRubricBody);
    assertAiRate(t.id);
    return c.json(await proposeRubric(activity, body));
  })

  .post("/:id/ai/reflection", async (c) => {
    const { t, activity } = await owned(c);
    const body = await readJson(c, aiReflectionBody);
    assertAiRate(t.id);
    return c.json(await proposeReflection(activity, body));
  })

  .post("/:id/rubric/import", async (c) => {
    const { t, activity } = await owned(c);
    assertAiRate(t.id);
    const [file] = await readFileParts(c);
    if (!file) throw badRequest("Elegí el archivo de la rúbrica.");
    return c.json(await importRubric(activity, file));
  });

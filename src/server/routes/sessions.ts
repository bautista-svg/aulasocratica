// A student's work in one activity (teacher only): detail, end / let continue, delete,
// journey PDF, rubric assessment, AI summary and "Radiografía del pensamiento".
import { Hono } from "hono";
import { reconcileReports } from "../services/reports/reconcile";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { readJson, notFound, badRequest, tooMany } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedSession, isUuid } from "../services/access";
import { audit } from "../services/audit";
import { hit } from "../lib/rate-limit";
import { log } from "../lib/logger";
import { confirmBody, rubricSaveBody, summaryBody, xrayItemPatch } from "@shared/contracts/sessions";
import { loadSessionDetail, summaryView } from "../services/sessions/detail";
import { buildJourneyPdf, journeyDisposition } from "../services/sessions/journey-pdf";
import { analyzeDeliverable, analyzeXray, clearRubricSuggestion, patchXrayItem, saveRubric, suggestRubric, summarize } from "../services/sessions/ai";
import { deliverableKeys, deliverableOf, deleteStoredKeys, retryDeliverable, serveTeacherDeliverable } from "../services/deliverables";
import { deliverableView } from "../services/sessions/detail";
import { deleteSession, endSession, reopenSession } from "../services/sessions/actions";
import { xrayList } from "../services/sessions/lists";

/** AI calls on students' work: generous for real use, bounded against accidental loops. */
function aiLimit(c: Context<AppEnv>) {
  if (!hit(`session-ai:${teacherOf(c).id}`, 30, 60_000)) throw tooMany("Pediste muchos análisis seguidos. Esperá un minuto y volvé a probar.");
}

const uuidOrUndefined = (v: string | undefined, what: string) => {
  if (!v) return undefined;
  if (!isUuid(v)) throw badRequest(`${what} no es válida.`);
  return v;
};

export const sessionRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  // Radiografía list: the workspace's works, completed first, with the x-ray review status.
  .get("/", async (c) => {
    const t = teacherOf(c);
    const view = c.req.query("view") ?? "radiografia";
    if (view !== "radiografia") throw badRequest("Vista desconocida.");
    const list = await xrayList(t.id, {
      classroomId: uuidOrUndefined(c.req.query("classroomId"), "El aula"),
      activityId: uuidOrUndefined(c.req.query("activityId"), "La actividad"),
      search: c.req.query("q"),
      cursor: c.req.query("cursor"),
    });
    return c.json(list);
  })

  .get("/:id", async (c) => {
    const row = await ownedSession(teacherOf(c).id, c.req.param("id"));
    return c.json(await loadSessionDetail(row));
  })

  .post("/:id/end", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    const changed = await endSession(row.session.id, row.activity.id);
    if (changed) await audit(c, t.id, "session_ended_by_teacher", "learning_session", row.session.id);
    return c.json({ ok: true, changed });
  })

  .post("/:id/reopen", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    const changed = await reopenSession(row.session.id, row.activity.id);
    if (changed) await audit(c, t.id, "session_reopened", "learning_session", row.session.id);
    return c.json({ ok: true, changed });
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    await readJson(c, confirmBody);
    const keys = await deliverableKeys({ sessionIds: [row.session.id] });
    await deleteSession(row.session.id, row.activity.id);
    await deleteStoredKeys(keys);
    await reconcileReports(t.id);
    await audit(c, t.id, "session_deleted", "learning_session", row.session.id, { activityId: row.activity.id });
    return c.json({ ok: true, activityId: row.activity.id, classroomId: row.activity.classroomId });
  })

  .get("/:id/journey.pdf", async (c) => {
    const row = await ownedSession(teacherOf(c).id, c.req.param("id"));
    const detail = await loadSessionDetail(row);
    const pdf = await buildJourneyPdf(detail);
    log.info("journey_pdf", { sessionId: row.session.id, bytes: pdf.length, messages: detail.messages.length });
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": journeyDisposition(detail),
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    });
  })

  // ── The file the student handed in ──
  .get("/:id/deliverable/file", async (c) => {
    const row = await ownedSession(teacherOf(c).id, c.req.param("id"));
    return serveTeacherDeliverable(c, row.session.id, c.req.query("download") === "1");
  })

  .post("/:id/deliverable/analyze", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    aiLimit(c);
    return c.json(await analyzeDeliverable(row, t.id));
  })

  .post("/:id/deliverable/retry", async (c) => {
    const row = await ownedSession(teacherOf(c).id, c.req.param("id"));
    await retryDeliverable(row.session.id);
    const d = await deliverableOf(row.session.id);
    if (!d) throw notFound("La entrega");
    return c.json({ deliverable: deliverableView(d) });
  })

  // ── Rubric assessment (AI suggests only when asked; the teacher decides) ──
  .post("/:id/rubric/suggest", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    aiLimit(c);
    return c.json(await suggestRubric(row, t.id));
  })

  // The teacher disagrees with the AI: remove its suggestion (all, or ?criterionId=… for one criterion).
  .delete("/:id/rubric/suggestion", async (c) => {
    const row = await ownedSession(teacherOf(c).id, c.req.param("id"));
    const criterionId = c.req.query("criterionId");
    if (criterionId !== undefined && (criterionId.length === 0 || criterionId.length > 40)) throw badRequest("Criterio inválido.");
    return c.json(await clearRubricSuggestion(row, criterionId));
  })

  .put("/:id/rubric", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    const body = await readJson(c, rubricSaveBody);
    const rubric = await saveRubric(row, body);
    if (body.confirm) await audit(c, t.id, "rubric_confirmed", "learning_session", row.session.id);
    return c.json({ rubric });
  })

  // ── AI summary ──
  .post("/:id/summary", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    const body = await readJson(c, summaryBody);
    aiLimit(c);
    const saved = await summarize(row, t.id, body.basis);
    return c.json({ summary: summaryView(saved) });
  })

  // ── Radiografía del pensamiento ──
  .post("/:id/xray/analyze", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    aiLimit(c);
    return c.json(await analyzeXray(row, t.id));
  })

  .patch("/:id/xray/items/:itemId", async (c) => {
    const t = teacherOf(c);
    const row = await ownedSession(t.id, c.req.param("id"));
    const itemId = c.req.param("itemId");
    if (!itemId || itemId.length > 40) throw notFound("La interpretación");
    const patch = await readJson(c, xrayItemPatch);
    const out = await patchXrayItem(row, itemId, patch);
    if (!out) throw notFound("La interpretación");
    return c.json(out);
  });

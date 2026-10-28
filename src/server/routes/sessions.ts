// A student's work in one activity (teacher only): detail, end / let continue, delete,
// journey PDF, rubric assessment, AI summary and "Radiografía del pensamiento".
// In a shared classroom acting on the work needs the "edit" role (deleting it, "manage"), and
// the AI calls are counted in the classroom owner's workspace (`row.activity.teacherId`).
import { Hono } from "hono";
import { reconcileReports } from "../services/reports/reconcile";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { readJson, notFound, badRequest, tooMany } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedSession, isUuid, requireRole } from "../services/access";
import type { ClassroomAction } from "@shared/domain/sharing";
import { audit } from "../services/audit";
import { hit } from "../lib/rate-limit";
import { log } from "../lib/logger";
import { confirmBody, rubricSaveBody, summaryBody, xrayItemPatch } from "@shared/contracts/sessions";
import { recommendationsBody, skillLevelBody } from "@shared/contracts/skills";
import { splitObjectives } from "@shared/domain/session-summary";
import { loadSessionDetail, summaryView } from "../services/sessions/detail";
import { buildJourneyPdf, journeyDisposition } from "../services/sessions/journey-pdf";
import { analyzeDeliverable, analyzeXray, clearRubricSuggestion, patchXrayItem, saveRubric, suggestRubric, summarize } from "../services/sessions/ai";
import { deliverableKeys, deliverableOf, deleteStoredKeys, retryDeliverable, serveTeacherDeliverable } from "../services/deliverables";
import { deliverableView } from "../services/sessions/detail";
import { deleteSession, endSession, reopenSession } from "../services/sessions/actions";
import { xrayList } from "../services/sessions/lists";
import { analyzeSkills, setRecommendations, setSkillLevel } from "../services/sessions/skills";

/** The group view analyzes many works in a row, so skills have their own, larger budget. */
function aspectsLimit(c: Context<AppEnv>) {
  if (!hit(`aspects-ai:${teacherOf(c).id}`, 60, 60_000)) throw tooMany("Pediste muchos análisis seguidos. Esperá un minuto y volvé a probar.");
}

/** AI calls on students' work: generous for real use, bounded against accidental loops. */
function aiLimit(c: Context<AppEnv>) {
  if (!hit(`session-ai:${teacherOf(c).id}`, 30, 60_000)) throw tooMany("Pediste muchos análisis seguidos. Esperá un minuto y volvé a probar.");
}

/** The work of the route, checking the teacher's role when the route changes something. */
async function work(c: Context<AppEnv>, action?: ClassroomAction) {
  const row = await ownedSession(teacherOf(c).id, c.req.param("id") ?? "");
  if (action) requireRole(row, action);
  return row;
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
    const row = await work(c);
    return c.json(await loadSessionDetail(row));
  })

  .post("/:id/end", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    const changed = await endSession(row.session.id, row.activity.id);
    if (changed) await audit(c, t.id, "session_ended_by_teacher", "learning_session", row.session.id);
    return c.json({ ok: true, changed });
  })

  .post("/:id/reopen", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    const changed = await reopenSession(row.session.id, row.activity.id);
    if (changed) await audit(c, t.id, "session_reopened", "learning_session", row.session.id);
    return c.json({ ok: true, changed });
  })

  .delete("/:id", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "manage");
    await readJson(c, confirmBody);
    const keys = await deliverableKeys({ sessionIds: [row.session.id] });
    await deleteSession(row.session.id, row.activity.id);
    await deleteStoredKeys(keys);
    await reconcileReports(row.activity.teacherId);
    await audit(c, t.id, "session_deleted", "learning_session", row.session.id, { activityId: row.activity.id });
    return c.json({ ok: true, activityId: row.activity.id, classroomId: row.activity.classroomId });
  })

  .get("/:id/journey.pdf", async (c) => {
    const row = await work(c);
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
    const row = await work(c);
    return serveTeacherDeliverable(c, row.session.id, c.req.query("download") === "1");
  })

  .post("/:id/deliverable/analyze", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    aiLimit(c);
    return c.json(await analyzeDeliverable(row, row.activity.teacherId));
  })

  .post("/:id/deliverable/retry", async (c) => {
    const row = await work(c, "edit");
    await retryDeliverable(row.session.id);
    const d = await deliverableOf(row.session.id);
    if (!d) throw notFound("La entrega");
    return c.json({ deliverable: deliverableView(d) });
  })

  // ── Rubric assessment (AI suggests only when asked; the teacher decides) ──
  .post("/:id/rubric/suggest", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    aiLimit(c);
    return c.json(await suggestRubric(row, row.activity.teacherId));
  })

  // "Habilidades": the AI evaluates each skill at a level with a quote; the teacher can correct a level.
  .post("/:id/skills/analyze", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    aspectsLimit(c);
    return c.json(await analyzeSkills(row, row.activity.teacherId));
  })

  .put("/:id/skills/recommendations", async (c) => {
    const row = await work(c, "edit");
    const body = await readJson(c, recommendationsBody);
    return c.json(await setRecommendations(row, body.recommendations));
  })

  .patch("/:id/skills/:skill", async (c) => {
    const row = await work(c, "edit");
    const skill = c.req.param("skill");
    if (skill.length > 40) throw badRequest("Habilidad inválida.");
    const body = await readJson(c, skillLevelBody);
    return c.json(await setSkillLevel(row, skill, body.status));
  })

  // The teacher disagrees with the AI: remove its suggestion (all, or ?criterionId=… for one criterion).
  .delete("/:id/rubric/suggestion", async (c) => {
    const row = await work(c, "edit");
    const criterionId = c.req.query("criterionId");
    if (criterionId !== undefined && (criterionId.length === 0 || criterionId.length > 40)) throw badRequest("Criterio inválido.");
    return c.json(await clearRubricSuggestion(row, criterionId));
  })

  .put("/:id/rubric", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    const body = await readJson(c, rubricSaveBody);
    const rubric = await saveRubric(row, body);
    if (body.confirm) await audit(c, t.id, "rubric_confirmed", "learning_session", row.session.id);
    return c.json({ rubric });
  })

  // ── AI summary ──
  .post("/:id/summary", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    const body = await readJson(c, summaryBody);
    aiLimit(c);
    const saved = await summarize(row, row.activity.teacherId, body.basis);
    return c.json({ summary: summaryView(saved, splitObjectives(row.activity.objectives)) });
  })

  // ── Radiografía del pensamiento ──
  .post("/:id/xray/analyze", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    aiLimit(c);
    return c.json(await analyzeXray(row, row.activity.teacherId));
  })

  .patch("/:id/xray/items/:itemId", async (c) => {
    const t = teacherOf(c);
    const row = await work(c, "edit");
    const itemId = c.req.param("itemId");
    if (!itemId || itemId.length > 40) throw notFound("La interpretación");
    const patch = await readJson(c, xrayItemPatch);
    const out = await patchXrayItem(row, itemId, patch);
    if (!out) throw notFound("La interpretación");
    return c.json(out);
  });

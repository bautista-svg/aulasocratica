// Alerts panel (teacher only): every student's alerts across classrooms and activities.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { readJson, parseWith } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { alertCount, alertInbox, setAlertStatus, setAlertsStatus } from "../services/alerts";
import { alertInboxQuery, bulkAlertStatusBody } from "@shared/contracts/alerts";
import { alertStatusBody } from "@shared/contracts/live";

export const alertRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const q = parseWith(alertInboxQuery, c.req.query());
    return c.json(await alertInbox(teacherOf(c).id, q));
  })

  .get("/count", async (c) => c.json(await alertCount(teacherOf(c).id)))

  .patch("/:alertId", async (c) => {
    const { status } = await readJson(c, alertStatusBody);
    return c.json({ alert: await setAlertStatus(teacherOf(c).id, c.req.param("alertId"), status) });
  })

  .post("/bulk", async (c) => {
    const { ids, status } = await readJson(c, bulkAlertStatusBody);
    const rows = await setAlertsStatus(teacherOf(c).id, ids, status);
    return c.json({ updated: rows.length });
  });

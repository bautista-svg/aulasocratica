// Live view of one activity (teacher only). Participants = the activity's learning sessions.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../types";
import { db, schema } from "../db/client";
import { readJson, notFound } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedActivity, isUuid } from "../services/access";
import { audit } from "../services/audit";
import { publish, subscribe } from "../lib/events";
import { log } from "../lib/logger";
import { alertStatusBody, confirmBody, LIVE_WINDOWS, type LiveWindow } from "@shared/contracts/live";
import { liveSnapshot } from "../services/sessions/live-snapshot";
import { endAll } from "../services/sessions/actions";

const DEBOUNCE_MS = 400;
const HEARTBEAT_MS = 25_000;

export const liveRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/:activityId", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    const w = c.req.query("window");
    const window: LiveWindow = (LIVE_WINDOWS as readonly string[]).includes(w ?? "") ? (w as LiveWindow) : "30m";
    return c.json(await liveSnapshot(activity, window));
  })

  // Server-Sent Events: a `change` event (coalesced over ~400 ms) whenever a session of this
  // activity changes, plus a heartbeat so proxies keep the connection open.
  .get("/:activityId/stream", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache, no-transform");
    return streamSSE(c, async (stream) => {
      let pending: { types: Set<string>; sessions: Set<string> } | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        const p = pending;
        pending = null;
        if (!p || stream.aborted || stream.closed) return;
        void stream
          .writeSSE({ event: "change", data: JSON.stringify({ types: [...p.types], sessionIds: [...p.sessions], at: Date.now() }) })
          .catch(() => undefined);
      };
      const unsubscribe = subscribe(activity.id, (e) => {
        pending ??= { types: new Set(), sessions: new Set() };
        pending.types.add(e.type);
        if (e.sessionId) pending.sessions.add(e.sessionId);
        timer ??= setTimeout(flush, DEBOUNCE_MS);
      });
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => undefined);
      }, HEARTBEAT_MS);
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => (resolveDone = resolve));
      const cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        resolveDone();
      };
      stream.onAbort(cleanup);
      c.req.raw.signal?.addEventListener("abort", cleanup, { once: true });
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ activityId: activity.id }), retry: 5000 });
      await done;
    });
  })

  .patch("/:activityId/alerts/:alertId", async (c) => {
    const activity = await ownedActivity(teacherOf(c).id, c.req.param("activityId"));
    const alertId = c.req.param("alertId");
    if (!isUuid(alertId)) throw notFound("La alerta");
    const { status } = await readJson(c, alertStatusBody);
    const [row] = await db
      .update(schema.studentAlerts)
      .set({ status, reviewedAt: status === "open" ? null : new Date() })
      .where(and(eq(schema.studentAlerts.id, alertId), eq(schema.studentAlerts.activityId, activity.id)))
      .returning();
    if (!row) throw notFound("La alerta");
    publish(activity.id, "alert", row.sessionId);
    return c.json({ alert: { id: row.id, status: row.status, reviewedAt: row.reviewedAt?.toISOString() ?? null } });
  })

  .post("/:activityId/end-all", async (c) => {
    const t = teacherOf(c);
    const activity = await ownedActivity(t.id, c.req.param("activityId"));
    await readJson(c, confirmBody);
    const ended = await endAll(activity.id);
    await audit(c, t.id, "sessions_ended_all", "activity", activity.id, { ended });
    log.info("live_end_all", { activityId: activity.id, ended });
    return c.json({ ended });
  });

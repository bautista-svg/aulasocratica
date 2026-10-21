import { Hono } from "hono";
import type { AppEnv } from "../types";
import { pingDb } from "../db/client";
import { aiStatus } from "../ai/client";
import { requireTeacher } from "../auth/teacher";

export const healthRoutes = new Hono<AppEnv>()
  // Liveness + readiness for Coolify/Docker: the process is up and the database answers.
  .get("/", async (c) => {
    const dbOk = await pingDb();
    return c.json({ status: dbOk ? "ok" : "degraded", db: dbOk ? "ok" : "down", version: process.env.APP_VERSION ?? "dev" }, dbOk ? 200 : 503);
  })
  // AI availability, so the UI can say so honestly instead of failing on every button.
  .get("/ai", requireTeacher, async (c) => c.json({ ai: await aiStatus() }));

// /api/help — "¿Dónde está…?": the assistant that says where something is and takes you there.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { readJson } from "../lib/errors";
import { rateLimit } from "../lib/rate-limit";
import { askHelp } from "../services/help";
import { helpAskBody } from "@shared/contracts/help";

const byTeacher = (c: Parameters<typeof teacherOf>[0]) => c.get("teacher")?.id ?? "anon";

export const helpRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .post("/ask", rateLimit("help-ask", 60, 60 * 60_000, byTeacher), async (c) => {
    const body = await readJson(c, helpAskBody);
    return c.json(await askHelp(teacherOf(c).id, body));
  });

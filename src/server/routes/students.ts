// One student's page (teacher only): their works across the activities of their classroom.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedStudent } from "../services/access";
import { studentDetail } from "../services/sessions/lists";

export const studentRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/:id", async (c) => {
    const row = await ownedStudent(teacherOf(c).id, c.req.param("id"));
    return c.json(await studentDetail(row));
  });

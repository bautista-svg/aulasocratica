// "Crear con IA": proposals grounded in the class data + material, and the activity created
// from the proposal the teacher chose and edited.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { readJson, tooMany } from "../lib/errors";
import { hit } from "../lib/rate-limit";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { ownedClassroom } from "../services/access";
import { generateProposals } from "../services/planning/proposals";
import { createActivityFromProposal } from "../services/planning/create";
import { createFromProposalBody, proposalsBody } from "@shared/contracts/planning";

export const planningRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .post("/proposals", async (c) => {
    const t = teacherOf(c);
    const body = await readJson(c, proposalsBody);
    if (!hit(`planning-proposals:${t.id}`, 30, 60 * 60_000)) {
      throw tooMany("Pediste muchas propuestas seguidas. Esperá unos minutos y probá de nuevo.");
    }
    if (body.classroomId) await ownedClassroom(t.id, body.classroomId);
    return c.json(await generateProposals(t.id, body));
  })

  .post("/create", async (c) => {
    const t = teacherOf(c);
    const body = await readJson(c, createFromProposalBody);
    return c.json(await createActivityFromProposal(t.id, body), 201);
  });

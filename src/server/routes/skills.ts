// /api/skills — which skills the workspace evaluates, and its own skills with their indicators.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { readJson } from "../lib/errors";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { audit } from "../services/audit";
import { saveSkillSettings, skillSettingsOf } from "../services/skill-settings";
import { skillCatalog } from "@shared/domain/skills";
import { skillSettingsBody } from "@shared/contracts/skills";

export const skillRoutes = new Hono<AppEnv>()
  .use("*", requireTeacher)

  .get("/", async (c) => {
    const settings = await skillSettingsOf(teacherOf(c).id);
    return c.json({ settings, catalog: skillCatalog(settings) });
  })

  .put("/", async (c) => {
    const t = teacherOf(c);
    const settings = await saveSkillSettings(t.id, await readJson(c, skillSettingsBody));
    await audit(c, t.id, "skill_settings_saved", "teacher", t.id, { enabled: settings.enabled.length, custom: settings.custom.length, unticked: Object.values(settings.off).flat().length });
    return c.json({ settings, catalog: skillCatalog(settings) });
  });

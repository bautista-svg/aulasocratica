// /api/settings — the app's appearance (accent color). Reading is public: the student pages and
// the landing use it too. Changing it needs the permission (services/appearance.ts).
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireTeacher, teacherOf } from "../auth/teacher";
import { forbidden, readJson } from "../lib/errors";
import { audit } from "../services/audit";
import { canChooseAppearance, currentAccent, setAccent } from "../services/appearance";
import { appearanceBody, type AppearanceResponse } from "@shared/contracts/settings";

export const settingsRoutes = new Hono<AppEnv>()
  .get("/appearance", async (c) => {
    const { accent, chosen } = await currentAccent();
    const body: AppearanceResponse = { accent, chosen, canChoose: await canChooseAppearance(c.get("teacher")?.id) };
    return c.json(body);
  })

  .put("/appearance", requireTeacher, async (c) => {
    const t = teacherOf(c);
    if (!(await canChooseAppearance(t.id))) throw forbidden("Solo quien administra la app puede cambiar el color.");
    const { accent } = await readJson(c, appearanceBody);
    await setAccent(t.id, accent);
    await audit(c, t.id, "appearance_changed", "app", null, { accent });
    const body: AppearanceResponse = { accent, chosen: true, canChoose: true };
    return c.json(body);
  });

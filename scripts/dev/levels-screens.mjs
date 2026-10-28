// Screens of "cuántos indicadores pide cada nivel" («Elegir habilidades» with the steppers, and the
// work's Habilidades with the indicators shown) at 375 and 1440 px with an axe-core check, against
// a local build with the fake Claude (scripts/dev/fake-claude.mjs).
// Usage: node scripts/dev/levels-screens.mjs http://localhost:4310 <output dir>
import path from "node:path";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:4310";
const OUT = process.argv[3] ?? "./capturas-niveles";
fs.mkdirSync(OUT, { recursive: true });
const AXE = path.resolve("node_modules/axe-core/axe.min.js");
const browser = await chromium.launch({ channel: "chrome" });
const headers = { origin: BASE, "x-aula-client": "1", "content-type": "application/json" };
let failures = 0;

const api = async (req, p, method, data) => {
  const r = await req.fetch(BASE + p, { method, data, headers });
  if (!r.ok()) throw new Error(`${method} ${p} ${r.status()} ${await r.text()}`);
  return r.headers()["content-type"]?.includes("json") ? r.json() : r.text();
};
async function audit(page, label, width) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") }));
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (violations.length || overflow > 0) failures++;
  console.log(`${violations.length || overflow > 0 ? "FAIL" : "OK  "} ${label} @${width}${overflow > 0 ? ` desborde ${overflow}px` : ""}${violations.length ? " " + JSON.stringify(violations) : ""}`);
}

// A teacher with one activity and one student's work.
const ctx = await browser.newContext({ locale: "es-AR", bypassCSP: true, viewport: { width: 1440, height: 900 } });
const teacher = await ctx.newPage();
await teacher.goto(BASE + "/");
await teacher.getByRole("button", { name: "Empezar sin cuenta" }).click();
await teacher.waitForURL(/\/app$/);
const t = teacher.request;
await api(t, "/api/auth/me/news", "POST", { id: "2026-10-29" });
const { classroom } = await api(t, "/api/classrooms", "POST", { name: "6.º A — Ciencias", grade: "6.º grado" });
const { activity } = await api(t, "/api/activities", "POST", { classroomId: classroom.id, title: "La fotosíntesis" });
await api(t, `/api/activities/${activity.id}`, "PATCH", { instructions: "¿Por qué las plantas necesitan luz? Explicalo con tus palabras.", requireInitialAnswer: false });
await api(t, `/api/activities/${activity.id}/publish`, "POST");
const token = (await api(t, `/api/activities/${activity.id}`, "GET")).activity.linkToken;

const sctx = await browser.newContext();
const s = sctx.request;
await api(s, `/api/s/${token}/join`, "POST", { name: "Ana Gómez" });
for (const text of [
  "Creo que la necesitan porque con la luz fabrican su propio alimento.",
  "Se pondría amarilla porque sin luz no puede hacer la fotosíntesis y no tiene energía.",
  "La clorofila atrapa la luz como un panel solar y con eso arma azúcares para crecer.",
  "Elegí la planta del balcón porque le da más sol, entonces crece más rápido que la del placard.",
]) {
  await api(s, `/api/s/${token}/chat`, "POST", { text });
}
const ws = await api(s, `/api/s/${token}`, "GET");
const sessionId = ws.workspace?.session?.id;
await sctx.close();

// Numbers per level for Argumentación (Logrado 2 de 3) and Comprensión (Logrado 3 de 4).
const settings = (await api(t, "/api/skills", "GET")).settings;
await api(t, "/api/skills", "PUT", {
  ...settings,
  levels: { argumentacion: { inicial: 0, en_desarrollo: 1, logrado: 2, avanzado: 3 }, comprension: { inicial: 0, en_desarrollo: 1, logrado: 3, avanzado: 4 } },
});
const live = await api(t, `/api/live/${activity.id}`, "GET");
const work = sessionId ?? live.participants[0].sessionId;
await api(t, `/api/sessions/${work}/skills/analyze`, "POST");

// 1. «Elegir habilidades», Argumentación open with its steppers.
for (const width of [1440, 375]) {
  await teacher.setViewportSize({ width, height: width < 800 ? 812 : 900 });
  await teacher.goto(`${BASE}/app/actividades/${activity.id}?tab=fortalezas`, { waitUntil: "networkidle" });
  await teacher.getByRole("button", { name: "Elegir habilidades" }).first().click();
  const dialog = teacher.getByRole("dialog", { name: "Elegir habilidades" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: /Elegir indicadores/ }).first().click();
  await dialog.getByRole("spinbutton").first().waitFor();
  await teacher.waitForTimeout(300);
  await teacher.screenshot({ path: path.join(OUT, `01-elegir-habilidades-${width}.png`) });
  // The steppers and the rule under them, in view.
  await dialog.getByText("Con 3: Avanzado", { exact: false }).first().scrollIntoViewIfNeeded();
  await teacher.waitForTimeout(200);
  await teacher.screenshot({ path: path.join(OUT, `02-niveles-${width}.png`) });
  await audit(teacher, "elegir habilidades", width);
  // A skill without numbers: the switch off, with today's rule.
  await dialog.getByRole("button", { name: /Elegir indicadores/ }).first().click();
  await teacher.keyboard.press("Escape");
}

// 2. The work's Habilidades: indicators shown, «2 de 3», each with its quote.
for (const width of [1440, 375]) {
  await teacher.setViewportSize({ width, height: width < 800 ? 812 : 900 });
  await teacher.goto(`${BASE}/app/sesiones/${work}?tab=evaluacion`, { waitUntil: "networkidle" });
  const card = teacher.locator("section[aria-labelledby='skills-title']");
  await card.getByRole("button", { name: /Argumentación/ }).click();
  await card.getByRole("button", { name: /Comprensión del tema/ }).click();
  await card.getByRole("button", { name: /Argumentación/ }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await teacher.waitForTimeout(300);
  await teacher.screenshot({ path: path.join(OUT, `03-habilidades-trabajo-${width}.png`) });
  await audit(teacher, "habilidades del trabajo", width);
}

// 3. The group view after changing the numbers: the notice to re-evaluate.
await api(t, "/api/skills", "PUT", { ...settings, levels: { argumentacion: { inicial: 0, en_desarrollo: 1, logrado: 3, avanzado: 3 } } });
for (const width of [1440, 375]) {
  await teacher.setViewportSize({ width, height: width < 800 ? 812 : 900 });
  await teacher.goto(`${BASE}/app/actividades/${activity.id}?tab=fortalezas`, { waitUntil: "networkidle" });
  const notice = teacher.getByText("Cambiaste cuántos indicadores pide cada nivel");
  await notice.waitFor();
  await notice.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await teacher.waitForTimeout(200);
  await teacher.screenshot({ path: path.join(OUT, `04-aviso-reevaluar-${width}.png`) });
  await audit(teacher, "aviso reevaluar", width);
}

console.log(`capturas en ${OUT}${failures ? ` · ${failures} con problemas` : ""}`);
await browser.close();
process.exit(failures ? 1 : 0);

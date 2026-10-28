// Screens of the divisions feature (classroom form, student entry in es/en, live view filtered,
// classroom students) at 375 and 1440 px with an axe-core check, against a local build.
// Usage: node scripts/dev/divisions-screens.mjs http://localhost:4302 <output dir>
import path from "node:path";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:4302";
const OUT = process.argv[3] ?? "./capturas-division";
fs.mkdirSync(OUT, { recursive: true });
const AXE = path.resolve("node_modules/axe-core/axe.min.js");
const browser = await chromium.launch({ channel: "chrome" });
const headers = { origin: BASE, "x-aula-client": "1", "content-type": "application/json" };
let failures = 0;

async function newPage(width) {
  // bypassCSP: axe is injected into the page.
  const ctx = await browser.newContext({ locale: "es-AR", bypassCSP: true, viewport: { width, height: width < 800 ? 812 : 900 } });
  return ctx.newPage();
}
const api = async (page, p, method, data) => {
  const r = await page.request.fetch(BASE + p, { method, data, headers });
  if (!r.ok()) throw new Error(`${method} ${p} ${r.status()} ${await r.text()}`);
  return r.json();
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
const shot = (page, name, width, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), ...opts });

// One teacher workspace with an English and a Spanish activity in a classroom with N, F, S.
const teacher = await newPage(1440);
await teacher.goto(BASE + "/");
await teacher.getByRole("button", { name: "Empezar sin cuenta" }).click();
await teacher.waitForURL(/\/app$/);
const { classroom } = await api(teacher, "/api/classrooms", "POST", { name: "1.º año — Lengua", grade: "1.º año", school: "Escuela N.º 12" });
const activityOf = async (title, language) => {
  const { activity } = await api(teacher, "/api/activities", "POST", { classroomId: classroom.id, title });
  await api(teacher, `/api/activities/${activity.id}`, "PATCH", { instructions: "Contá qué aprendiste hoy.", requireInitialAnswer: false, language });
  await api(teacher, `/api/activities/${activity.id}/publish`, "POST");
  return (await api(teacher, `/api/activities/${activity.id}`, "GET")).activity;
};

// 1. Classroom form: the divisions typed as chips.
for (const width of [375, 1440]) {
  const page = await newPage(width);
  await page.context().addCookies(await teacher.context().cookies());
  await page.goto(`${BASE}/app/aulas/${classroom.id}`, { waitUntil: "networkidle" });
  const news = page.getByRole("dialog", { name: "Nuevos cambios en la aplicación" });
  if (await news.isVisible().catch(() => false)) await news.getByRole("button", { name: "Entendido" }).click();
  await page.getByRole("button", { name: "Más opciones del aula" }).click();
  await page.getByRole("menuitem", { name: "Editar datos del aula" }).click();
  const box = page.getByLabel(/Divisiones que eligen los alumnos/);
  await box.fill("N, F, ");
  await box.fill("S");
  await box.press("Enter");
  await page.getByText("Si lo dejás vacío, no se pregunta.", { exact: false }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await audit(page, "formulario del aula", width);
  await shot(page, "1-formulario-aula", width);
  if (width === 1440) {
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.getByText("Cambios guardados").waitFor();
  }
  await page.context().close();
}

const es = await activityOf("¿Qué aprendimos hoy?", "es");
const en = await activityOf("What did we learn today?", "en");

// 2. Student entry, in Spanish and in English (with the error when no division is picked).
for (const [act, lang] of [[es, "es"], [en, "en"]]) {
  for (const width of [375, 1440]) {
    const page = await newPage(width);
    await page.goto(`${BASE}/clase/${act.linkToken}`, { waitUntil: "networkidle" });
    await page.getByRole("textbox").first().fill(lang === "es" ? "Lucía Gómez" : "Lucy Gomez");
    await page.getByRole("button", { name: lang === "es" ? "Entrar a la actividad" : "Join the activity" }).click();
    await page.waitForTimeout(200);
    await audit(page, `entrada del alumno (${lang}, sin elegir)`, width);
    await shot(page, `2-entrada-${lang}-error`, width, { fullPage: true });
    await page.getByRole("radio", { name: "F" }).check({ force: true });
    await page.waitForTimeout(150);
    await audit(page, `entrada del alumno (${lang}, F elegida)`, width);
    await shot(page, `2-entrada-${lang}`, width, { fullPage: true });
    await page.context().close();
  }
}

// 3. Students join the Spanish activity with their divisions (one without: classroom changed later).
const students = [
  ["Ana Gómez", "N"],
  ["Bruno Pérez", "N"],
  ["Camila Ruiz", "F"],
  ["Dante Sosa", "S"],
  ["Elena Vidal", "F"],
  ["Facundo Ríos", "S"],
];
for (const [name, division] of students) {
  const ctx = await browser.newContext();
  const r = await ctx.request.fetch(`${BASE}/api/s/${es.linkToken}/join`, { method: "POST", data: { name, division }, headers });
  if (!r.ok()) throw new Error(`join ${name} ${r.status()}`);
  await ctx.close();
}

// 4. Live view filtered by F, and the classroom's students.
for (const width of [375, 1440]) {
  const page = await newPage(width);
  await page.context().addCookies(await teacher.context().cookies());
  await page.goto(`${BASE}/app/actividades/${es.id}?tab=en-vivo`, { waitUntil: "networkidle" });
  const news = page.getByRole("dialog", { name: "Nuevos cambios en la aplicación" });
  if (await news.isVisible().catch(() => false)) await news.getByRole("button", { name: "Entendido" }).click();
  await page.getByRole("group", { name: "División" }).getByRole("button", { name: /^F/ }).click();
  await page.waitForTimeout(300);
  await audit(page, "en vivo filtrado por F", width);
  await shot(page, "3-en-vivo-F", width, { fullPage: true });

  await page.goto(`${BASE}/app/aulas/${classroom.id}?tab=alumnos`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await audit(page, "alumnos del aula", width);
  await shot(page, "4-alumnos", width, { fullPage: true });
  await page.getByRole("button", { name: "Opciones de Camila Ruiz" }).click();
  await page.getByRole("menuitem", { name: "Corregir nombre o división" }).click();
  await page.waitForTimeout(250);
  await audit(page, "corregir división", width);
  await shot(page, "4-alumnos-corregir", width);
  await page.context().close();
}

await api(teacher, "/api/auth/workspace", "DELETE", { confirm: "BORRAR" });
await browser.close();
console.log(failures ? `${failures} pantallas con problemas` : "Sin violaciones de axe ni desbordes");
process.exit(failures ? 1 : 0);

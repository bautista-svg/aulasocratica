// axe-core accessibility sweep of every screen of a deployed instance, at 375 and 1440 px, with a
// throwaway workspace (one classroom, a published activity, a material and one student) that is
// deleted at the end. Usage: node scripts/dev/prod-axe.mjs https://aulasocratica.becode.com.ar
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
const AXE = path.resolve("node_modules/axe-core/axe.min.js");
const browser = await chromium.launch({ channel: "chrome" });
// The site's CSP (correctly) blocks injected scripts; axe needs to be injected, so the test browser bypasses it.
const ctx = await browser.newContext({ locale: "es-AR", bypassCSP: true });
const page = await ctx.newPage();
const headers = { origin: BASE, "x-aula-client": "1", "content-type": "application/json" };
const api = async (p, method, data, on = page) => {
  const r = await on.request.fetch(BASE + p, { method, data, headers });
  if (!r.ok()) throw new Error(`${method} ${p} ${r.status()} ${await r.text()}`);
  return r.json();
};

const results = [];
let started = false;
async function check(p, label) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") }));
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    results.push({ label, width, violations, overflow });
    console.log(`${violations.length || overflow > 0 ? "FAIL" : "OK  "} ${label} @${width}${overflow > 0 ? ` desborde ${overflow}px` : ""}${violations.length ? " " + JSON.stringify(violations) : ""}`);
  }
}

try {
  await check("/", "portada");
  await check("/ingresar", "ingresar");
  await check("/privacidad", "privacidad");
  await check("/clase/token-inexistente", "enlace inexistente");
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Empezar sin cuenta" }).click();
  await page.waitForURL(/\/app$/);
  started = true;
  // Empty states of a brand-new workspace.
  for (const [p, label] of [
    ["/app", "inicio (vacío)"],
    ["/app/aulas", "aulas (vacío)"],
    ["/app/materiales", "mis materiales (vacío)"],
    ["/app/radiografia", "radiografía (vacío)"],
    ["/app/informes", "informes (vacío)"],
  ]) await check(p, label);
  const { classroom } = await api("/api/classrooms", "POST", { name: "5.º B — Ciencias", subject: "Ciencias Naturales", grade: "5.º grado" });
  await check(`/app/aulas/${classroom.id}`, "aula sin actividades");
  await check(`/app/aulas/${classroom.id}?tab=alumnos`, "aula sin alumnos");
  const { activity } = await api("/api/activities", "POST", { classroomId: classroom.id, title: "¿Por qué flotan los barcos?" });
  await api(`/api/activities/${activity.id}`, "PATCH", { instructions: "Explicá por qué flota un barco de acero." });
  await api(`/api/activities/${activity.id}/publish`, "POST");
  await api("/api/materials", "POST", { kind: "text", title: "Flotación (apunte)", body: "Un objeto flota si desplaza un peso de agua igual al suyo." });
  const token = (await api(`/api/activities/${activity.id}`, "GET")).activity.linkToken;

  const student = await (await browser.newContext({ locale: "es-AR", bypassCSP: true })).newPage();
  await api(`/api/s/${token}/join`, "POST", { name: "Ana Gómez" }, student);
  await api(`/api/s/${token}/initial`, "POST", { answer: "Flota porque el acero es liviano." }, student);
  await student.setViewportSize({ width: 375, height: 812 });
  await student.goto(`${BASE}/clase/${token}`, { waitUntil: "networkidle" });
  await student.addScriptTag({ path: AXE });
  const sv = await student.evaluate(async () => (await window.axe.run(document)).violations.map((v) => ({ id: v.id, nodes: v.nodes.length })));
  results.push({ label: "alumno: charla", width: 375, violations: sv, overflow: 0 });
  console.log(`${sv.length ? "FAIL" : "OK  "} alumno: charla @375${sv.length ? " " + JSON.stringify(sv) : ""}`);
  await check(`/clase/${token}`, "alumno: entrada (otro dispositivo)");

  const live = await api(`/api/live/${activity.id}`, "GET");
  const sessionId = live.participants[0].sessionId;
  for (const [p, label] of [
    ["/app", "inicio"],
    ["/app/aulas", "aulas"],
    [`/app/aulas/${classroom.id}`, "aula: actividades"],
    [`/app/aulas/${classroom.id}?tab=alumnos`, "aula: alumnos"],
    [`/app/aulas/${classroom.id}?tab=alertas`, "aula: alertas"],
    [`/app/actividades/${activity.id}?tab=configuracion`, "actividad: configuración"],
    [`/app/actividades/${activity.id}?tab=compartir`, "actividad: compartir"],
    [`/app/actividades/${activity.id}?tab=en-vivo`, "actividad: en vivo"],
    [`/app/sesiones/${sessionId}?tab=recorrido`, "trabajo: recorrido"],
    [`/app/sesiones/${sessionId}?tab=conversacion`, "trabajo: conversación"],
    [`/app/sesiones/${sessionId}?tab=evaluacion`, "trabajo: evaluación"],
    [`/app/sesiones/${sessionId}?tab=radiografia`, "trabajo: radiografía"],
    ["/app/crear", "crear con IA"],
    ["/app/tutores", "mis tutores"],
    ["/app/materiales", "mis materiales"],
    ["/app/radiografia", "radiografía"],
    ["/app/informes", "informes"],
    ["/app/cuenta", "mi espacio"],
  ]) await check(p, label);
} finally {
  if (started) try {
    await api("/api/auth/workspace", "DELETE", { confirm: "BORRAR" });
    console.log("espacio de prueba borrado");
  } catch (e) {
    console.log("no se pudo borrar el espacio de prueba:", String(e));
  }
  await browser.close();
  const bad = results.filter((r) => r.violations.length || r.overflow > 0);
  console.log(`\n${results.length - bad.length}/${results.length} pantallas sin violaciones de axe ni desborde horizontal`);
}

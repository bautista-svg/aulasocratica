// Screens + axe of "Compartir aula" (dialog, invitation without and with an account, the member's
// list, a classroom and an activity seen by a reader) against a local build, with test accounts
// (…@prueba.test). Usage: node scripts/dev/sharing-screens.mjs http://localhost:4303 [outDir]
// PW_EXEC=<chrome.exe> uses another browser when the installed Chrome does not start headless.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:4303";
const OUT = process.argv[3] ?? "C:/Users/gonib/Downloads/aulasocratica-capturas/compartir";
const AXE = path.resolve("node_modules/axe-core/axe.min.js");
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : { channel: "chrome" });
const headers = { origin: BASE, "x-aula-client": "1", "content-type": "application/json" };

async function newPerson(name, { account = true } = {}) {
  const ctx = await browser.newContext({ locale: "es-AR", bypassCSP: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const api = async (p, method = "GET", data) => {
    const r = await page.request.fetch(BASE + p, { method, data, headers });
    if (!r.ok()) throw new Error(`${method} ${p} ${r.status()} ${await r.text()}`);
    return r.json();
  };
  if (account !== null) {
    await api("/api/auth/start", "POST", { displayName: name });
    if (account) await api("/api/auth/register", "POST", { email: `${name.split(" ")[0].toLowerCase()}-${stamp}@prueba.test`, password: "clave-de-prueba-larga-123" });
  }
  // Skip the "Novedades" notice in screenshots.
  const me = await api("/api/auth/me").catch(() => null);
  if (me?.teacher) await api("/api/auth/me/news", "POST", { id: "2026-10-28c" }).catch(() => {});
  return { ctx, page, api };
}

const results = [];
async function axe(page, label, width) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") }));
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  results.push({ label, width, violations, overflow });
  console.log(`${violations.length || overflow > 0 ? "FAIL" : "OK  "} ${label} @${width}${overflow > 0 ? ` desborde ${overflow}px` : ""}${violations.length ? " " + JSON.stringify(violations) : ""}`);
}

/** Opens `url` at both widths, optionally runs `prepare`, screenshots and checks. */
async function shoot(person, url, name, prepare, { full = true } = {}) {
  for (const width of [375, 1440]) {
    await person.page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
    await person.page.goto(BASE + url, { waitUntil: "networkidle" });
    await person.page.waitForTimeout(300);
    if (prepare) await prepare(person.page, width);
    await person.page.waitForTimeout(300);
    await person.page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: full });
    await axe(person.page, name, width);
  }
}

try {
  const owner = await newPerson("Vanina Prueba");
  const { classroom } = await owner.api("/api/classrooms", "POST", {
    name: "Social Studies- 1° ES",
    school: "Northfield School",
    teacherName: "Vanina Prueba",
    grade: "1.º",
    division: "ES",
  });
  const { activity } = await owner.api("/api/activities", "POST", { classroomId: classroom.id, title: "La Revolución de Mayo" });
  await owner.api(`/api/activities/${activity.id}`, "PATCH", { instructions: "¿Por qué 1810 fue un cambio? Explicá con tus palabras." });
  await owner.api(`/api/activities/${activity.id}/publish`, "POST");
  const { activity: draft } = await owner.api("/api/activities", "POST", { classroomId: classroom.id, title: "El Virreinato del Río de la Plata" });
  void draft;
  await owner.api(`/api/classrooms/${classroom.id}/students`, "POST", { names: ["Ana Pérez", "Bruno Díaz", "Carla Gómez"] });

  // A member already in, so the dialog has people with roles.
  const editor = await newPerson("Martín Prueba");
  const editorLink = await owner.api(`/api/classrooms/${classroom.id}/invites`, "POST", { role: "editor" });
  await editor.api(`/api/invites/${editorLink.token}/accept`, "POST");

  // 1. Owner's "Compartir aula" dialog, with a fresh link.
  await shoot(owner, `/app/aulas/${classroom.id}`, "1-dialogo-compartir", async (page) => {
    await page.getByRole("button", { name: "Más opciones del aula" }).click();
    await page.getByRole("menuitem", { name: "Compartir aula" }).click();
    await page.getByRole("radio", { name: "Lector" }).check();
    await page.getByRole("button", { name: "Crear enlace de invitación" }).click();
    await page.getByText("Enlace para Lector").waitFor();
  }, { full: false });

  // 2. Invitation link without an account (a device with nothing).
  const readerLink = await owner.api(`/api/classrooms/${classroom.id}/invites`, "POST", { role: "reader" });
  const visitor = await newPerson("Visitante", { account: null });
  await shoot(visitor, `/invitacion/${readerLink.token}`, "2-invitacion-sin-cuenta");

  // 3. Invitation link with an account, then accept.
  const reader = await newPerson("Lucía Prueba");
  await reader.api("/api/classrooms", "POST", { name: "Historia 2.º A", school: "Escuela 12", grade: "2.º", division: "A" });
  await shoot(reader, `/invitacion/${readerLink.token}`, "3-invitacion-con-cuenta");
  await reader.page.setViewportSize({ width: 1440, height: 900 });
  await reader.page.goto(BASE + `/invitacion/${readerLink.token}`, { waitUntil: "networkidle" });
  await reader.page.getByRole("button", { name: "Aceptar y abrir el aula" }).click();
  await reader.page.waitForURL(new RegExp(`/app/aulas/${classroom.id}`));

  // 4. The member's list of classrooms (own + shared).
  await shoot(reader, "/app/aulas", "4-aulas-del-miembro");
  // 5. The classroom seen by a reader, and one of its activities.
  await shoot(reader, `/app/aulas/${classroom.id}`, "5-aula-vista-por-lector");
  await shoot(reader, `/app/aulas/${classroom.id}?tab=alertas`, "5b-alertas-del-aula-lector");
  await shoot(reader, `/app/actividades/${activity.id}?tab=configuracion`, "6-actividad-vista-por-lector");
  // The editor's view of the dialog (no invites, can leave).
  await shoot(editor, `/app/aulas/${classroom.id}`, "7-dialogo-editor", async (page) => {
    await page.getByRole("button", { name: "Más opciones del aula" }).click();
    await page.getByRole("menuitem", { name: "Ver quiénes tienen acceso" }).click();
    await page.getByRole("dialog").waitFor();
  }, { full: false });
  // A used link.
  await shoot(visitor, `/invitacion/${editorLink.token}`, "8-invitacion-usada");
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.violations.length || r.overflow > 0);
  console.log(bad.length ? `\n${bad.length} con problemas` : "\nSin violaciones ni desbordes");
}

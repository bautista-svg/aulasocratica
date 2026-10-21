// Final evidence screenshots from a deployed instance (throwaway workspace, deleted at the end).
// Usage: node scripts/dev/evidence-screens.mjs https://aulasocratica.becode.com.ar docs/informes/evidencia-final
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://aulasocratica.becode.com.ar";
const OUT = path.resolve(process.argv[3] ?? "docs/informes/evidencia-final");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const teacherCtx = await browser.newContext({ locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
const page = await teacherCtx.newPage();
const api = async (method, p, data) => {
  const r = await page.request.fetch(BASE + p, { method, data, headers: { origin: BASE, "x-aula-client": "1", "content-type": "application/json" } });
  if (!r.ok()) throw new Error(`${method} ${p} ${r.status()} ${await r.text()}`);
  return r.json();
};
const shot = async (p, name, widths = [375, 1440]) => {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 800 ? 812 : 900 });
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: false });
  }
};

try {
  await shot("/", "01-portada");
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Empezar sin cuenta" }).click();
  await page.waitForURL(/\/app$/);
  await api("PATCH", "/api/auth/me", { displayName: "Profe Laura" });
  const { classroom } = await api("POST", "/api/classrooms", { name: "5.º B — Ciencias Naturales", subject: "Ciencias Naturales", grade: "5.º grado", division: "B" });
  const { activity } = await api("POST", "/api/activities", { classroomId: classroom.id, title: "¿Por qué flotan los barcos?" });
  await api("PATCH", `/api/activities/${activity.id}`, {
    instructions: "Explicá con tus palabras por qué un barco de acero puede flotar en el agua, aunque una piedra chiquita se hunda.",
    objectives: "Relacionar la flotación con el agua que desplaza un objeto.\nJustificar con un ejemplo propio.",
  });
  await api("POST", `/api/activities/${activity.id}/publish`);
  const token = (await api("GET", `/api/activities/${activity.id}`)).activity.linkToken;

  // Two students with the real tutor.
  for (const [name, first, msg] of [
    ["Ana Gómez", "Creo que flota porque el acero es liviano.", "¿Pero entonces por qué la piedra se hunde?"],
    ["Bruno Pérez", "Flota porque tiene aire adentro.", "¿El aire hace que pese menos?"],
  ]) {
    const ctx = await browser.newContext({ locale: "es-AR" });
    const s = await ctx.newPage();
    await s.setViewportSize({ width: 375, height: 812 });
    await s.goto(`${BASE}/clase/${token}`, { waitUntil: "networkidle" });
    if (name === "Ana Gómez") await s.screenshot({ path: path.join(OUT, "07-alumno-entrada-375.png") });
    await s.getByRole("textbox").first().fill(name);
    await s.getByRole("button", { name: "Entrar a la actividad" }).click();
    await s.getByLabel("Tu primera idea").fill(first);
    await s.getByRole("button", { name: "Guardar y empezar a conversar" }).click();
    await s.locator("#composer").fill(msg);
    await s.locator("#composer").press("Enter");
    await s.waitForTimeout(9000);
    if (name === "Ana Gómez") await s.screenshot({ path: path.join(OUT, "08-alumno-chat-375.png") });
    await ctx.close();
  }

  await shot("/app", "02-inicio");
  await shot(`/app/aulas/${classroom.id}`, "03-aula");
  await shot(`/app/aulas/${classroom.id}?tab=alumnos&actividad=${activity.id}`, "04-aula-alumnos-por-actividad", [375]);
  await shot(`/app/actividades/${activity.id}?tab=configuracion`, "05-actividad-configuracion");
  await shot(`/app/actividades/${activity.id}?tab=compartir`, "06-actividad-compartir", [375]);
  await shot(`/app/actividades/${activity.id}?tab=en-vivo`, "09-en-vivo");
  const live = await api("GET", `/api/live/${activity.id}`);
  const ana = live.participants.find((p) => p.studentName === "Ana Gómez");
  await shot(`/app/sesiones/${ana.sessionId}?tab=recorrido`, "10-trabajo-recorrido");
  await shot(`/app/sesiones/${ana.sessionId}?tab=conversacion`, "11-trabajo-conversacion", [375]);
  await shot("/app/tutores", "12-mis-tutores");
  await shot("/app/crear", "13-crear-con-ia", [375]);
  await shot("/app/materiales", "14-mis-materiales", [1440]);
  await shot("/app/cuenta", "15-mi-espacio", [375]);
  await shot("/privacidad", "16-privacidad", [375]);
  console.log(`capturas en ${OUT}`);
} finally {
  try {
    await api("DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
    console.log("espacio de prueba borrado");
  } catch (e) {
    console.log("no se pudo borrar el espacio de prueba:", String(e));
  }
  await browser.close();
}

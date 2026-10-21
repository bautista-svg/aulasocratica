// Repite los pasos de scripts/20-reproducir-defectos.mjs para D03 y D05 (que apunta a :4300)
// contra el servidor de desarrollo. Uso: BASE=http://localhost:5173 node .../reproducir-D03-D05.mjs
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5173";
const b = await chromium.launch({ channel: "chrome" });
const doc = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR" });
const p = await doc.newPage();
const out = {};
await p.goto(BASE + "/", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Empezar sin cuenta" }).click();
await p.waitForURL(/\/app/);
// Aula + actividad con el título largo de la auditoría (D03)
await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nueva aula" }).first().click();
await p.getByRole("dialog").getByLabel("Nombre del aula").fill("Repro D03 D05");
await p.getByRole("dialog").getByRole("button", { name: "Crear aula" }).click();
await p.waitForURL(/\/app\/aulas\/[0-9a-f-]{36}/);
await p.getByRole("button", { name: "Nueva actividad" }).first().click();
await p.getByRole("dialog").getByLabel("Título").fill("Fracciones equivalentes: comparación y ordenamiento en la recta numérica");
await p.getByRole("dialog").getByRole("button", { name: "Crear y seguir" }).click();
await p.waitForURL(/\/app\/actividades\//);
// D05 — como la auditoría: con teclado, "Nueva aula" en Aulas → Escape
await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nueva aula" }).first().focus();
await p.keyboard.press("Enter");
await p.getByRole("dialog").waitFor();
await p.keyboard.press("Escape");
await p.waitForTimeout(1000);
out.D05_foco_tras_cerrar = await p.evaluate(() => `${document.activeElement.tagName} "${document.activeElement.textContent.trim()}"`);
await p.keyboard.press("Tab");
out.D05_siguiente_tab = await p.evaluate(() => `${document.activeElement.tagName} "${document.activeElement.textContent.trim().slice(0, 30)}"`);
// D03 — Inicio en 375 px
const m = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: await doc.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/app", { waitUntil: "networkidle" });
await mp.waitForTimeout(800);
out.D03_inicio_375 = await mp.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
await mp.screenshot({ path: new URL("./R-D03-inicio-375.png", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1") });
console.log(JSON.stringify(out, null, 2));
await b.close();

// Barrido: cada pantalla × cada viewport. Mide overflow horizontal, objetivos táctiles < 44px,
// título, h1, aria-current, errores de consola, y corre axe-core en 375 y 1440.
import { launch, context, instrument, shot, overflow, smallTargets, axe, BASE, DATA, save } from "./lib.mjs";
import fs from "node:fs";

const ids = JSON.parse(fs.readFileSync(DATA + "/ids.json", "utf8"));
const VIEWPORTS = (process.argv[2] || "320,375,390,430,768,1024,1440").split(",").map(Number);
const AXE_AT = new Set([375, 1440]);

const screens = [
  // [clave, estado, url]
  ["landing", null, "/"],
  ["ingresar", null, "/ingresar"],
  ["recuperar", null, "/ingresar?modo=recuperar"],
  ["privacidad", null, "/privacidad"],
  ["admin-login", null, "/admin"],
  ["404", null, "/no-existe-esta-ruta"],
  ["app-sin-espacio", null, "/app"],
  ["clase-token-invalido", null, "/clase/tokeninvalido123"],
  ["alumno-entrada", null, ids.link1.replace(BASE, "")],
  ["alumno-chat", "alumno-ana-state.json", ids.link1.replace(BASE, "")],
  ["alumno-terminado", "alumno-bruno-state.json", ids.link1.replace(BASE, "")],
  ["inicio", "docente-state.json", "/app"],
  ["aulas", "docente-state.json", "/app/aulas"],
  ["aula-actividades", "docente-state.json", ids.aulaUrl.replace(BASE, "")],
  ["aula-alumnos", "docente-state.json", ids.aulaUrl.replace(BASE, "") + "?tab=alumnos"],
  ["aula-alertas", "docente-state.json", ids.aulaUrl.replace(BASE, "") + "?tab=alertas"],
  ["act-configuracion", "docente-state.json", ids.act1.replace(BASE, "") + "?tab=configuracion"],
  ["act-compartir", "docente-state.json", ids.act1.replace(BASE, "") + "?tab=compartir"],
  ["act-envivo", "docente-state.json", ids.act1.replace(BASE, "") + "?tab=en-vivo"],
  ["sesion-recorrido", "docente-state.json", ids.sesionAna.replace(BASE, "")],
  ["sesion-conversacion", "docente-state.json", ids.sesionAna.replace(BASE, "") + "?tab=conversacion"],
  ["sesion-evaluacion", "docente-state.json", ids.sesionAna.replace(BASE, "") + "?tab=evaluacion"],
  ["sesion-radiografia", "docente-state.json", ids.sesionAna.replace(BASE, "") + "?tab=radiografia"],
  ["crear-ia", "docente-state.json", "/app/crear"],
  ["tutores", "docente-state.json", "/app/tutores"],
  ["materiales", "docente-state.json", "/app/materiales"],
  ["radiografia", "docente-state.json", "/app/radiografia"],
  ["informes", "docente-state.json", "/app/informes"],
  ["informe-detalle", "docente-state.json", ids.informe.replace(BASE, "")],
  ["cuenta", "docente-state.json", "/app/cuenta"],
];

const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const browser = await launch();
const results = [];
for (const vw of VIEWPORTS) {
  const vh = vw < 768 ? 812 : vw < 1200 ? 1024 : 900;
  const ctxs = {};
  for (const [key, state, url] of screens) {
    if (only && !only.has(key)) continue;
    const ck = state || "anon";
    if (!ctxs[ck]) ctxs[ck] = await context(browser, { width: vw, height: vh, state: state ? DATA + "/" + state : undefined, mobile: vw < 768, deviceScaleFactor: 1 });
    const page = await ctxs[ck].newPage();
    const log = [];
    instrument(page, key, log);
    const t0 = Date.now();
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 });
    } catch (e) { log.push({ kind: "goto", text: String(e).slice(0, 200) }); }
    await page.waitForTimeout(900);
    const r = { key, vw, url, ms: Date.now() - t0 };
    r.title = await page.title();
    r.h1 = await page.$$eval("h1", (hs) => hs.map((h) => h.innerText.trim().slice(0, 60)));
    r.ariaCurrent = await page.$$eval("[aria-current=page]", (es) => es.map((e) => (e.getAttribute("aria-label") || e.innerText).trim().slice(0, 30)));
    r.overflow = await overflow(page);
    if (vw <= 430) r.smallTargets = await smallTargets(page);
    r.tabbar = await page.evaluate(() => {
      const n = [...document.querySelectorAll("nav")].find((x) => { const s = getComputedStyle(x); return (s.position === "fixed" || s.position === "sticky") && x.getBoundingClientRect().bottom >= innerHeight - 2 && x.offsetParent !== null; });
      return n ? { h: Math.round(n.getBoundingClientRect().height), items: n.innerText.replace(/\n+/g, "|") } : null;
    });
    if (AXE_AT.has(vw)) r.axe = await axe(page);
    r.log = log.filter((l) => !(l.kind === "http404" && key === "clase-token-invalido") && !(l.kind === "console.error" && /404/.test(l.text) && key === "clase-token-invalido"));
    const name = `B-${key}-${vw}`;
    await shot(page, name);
    if (vw === 375 || vw === 1440) await shot(page, name + "-full", true);
    results.push(r);
    console.log(vw, key, r.overflow.overflow ? "OVERFLOW " + r.overflow.scrollWidth : "ok", r.axe ? "axe:" + r.axe.map((a) => a.id).join(",") : "", r.log.length ? "LOG:" + r.log.length : "");
    await page.close();
  }
  for (const c of Object.values(ctxs)) await c.close();
}
save("barrido-" + VIEWPORTS.join("_") + (only ? "-parcial" : "") + ".json", results);
await browser.close();

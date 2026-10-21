// Utilidades compartidas para la auditoría (no toca el código del proyecto)
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const BASE = "http://localhost:4300";
export const ROOT = "C:/Users/gonib/Downloads/aulasocratica/docs/informes/auditoria-ui";
export const EVID = path.join(ROOT, "evidencia");
export const DATA = path.join(ROOT, "scripts", "data");
export const AXE = "C:/Users/gonib/Downloads/aulasocratica/node_modules/axe-core/axe.min.js";
fs.mkdirSync(EVID, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

export async function launch(opts = {}) {
  return chromium.launch({ channel: "chrome", headless: true, ...opts });
}

// Contexto con bypassCSP para poder inyectar axe-core (la app tiene CSP script-src 'self')
export async function context(browser, { width = 1440, height = 900, state, mobile = false, ...rest } = {}) {
  return browser.newContext({
    viewport: { width, height },
    locale: "es-AR",
    bypassCSP: true,
    acceptDownloads: true,
    ...(state ? { storageState: state } : {}),
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...rest,
  });
}

// Registra errores de consola y requests fallidos por página
export function instrument(page, label, log) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      log.push({ label, kind: "console." + m.type(), url: page.url(), text: m.text().slice(0, 400) });
    }
  });
  page.on("pageerror", (e) => log.push({ label, kind: "pageerror", url: page.url(), text: String(e).slice(0, 400) }));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText || "";
    if (f.includes("ERR_ABORTED")) return;
    log.push({ label, kind: "requestfailed", url: r.url(), text: f });
  });
  page.on("response", (r) => {
    if (r.status() >= 400) log.push({ label, kind: "http" + r.status(), url: r.url(), text: r.request().method() });
  });
}

export async function shot(page, name, full = false) {
  const p = path.join(EVID, name.endsWith(".png") ? name : name + ".png");
  await page.screenshot({ path: p, fullPage: full });
  return p;
}

export async function overflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    // clientWidth = ancho del layout viewport sin scrollbar (en contextos móviles innerWidth crece si hay overflow)
    const W = de.clientWidth;
    const res = { scrollWidth: de.scrollWidth, clientWidth: W, innerWidth: window.innerWidth, overflow: de.scrollWidth > W + 1 };
    if (res.overflow) {
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > W + 1 && r.width > 0) {
          offenders.push((el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 3).join(".") : "")) + ` right=${Math.round(r.right)} w=${Math.round(r.width)} txt=${(el.innerText || "").slice(0, 40).replace(/\n/g, " ")}`);
          if (offenders.length > 8) break;
        }
      }
      res.offenders = offenders;
    }
    return res;
  });
}

export async function smallTargets(page, min = 44) {
  return page.evaluate((min) => {
    const out = [];
    const els = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], summary");
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") continue;
      // links inline dentro de párrafos se excluyen (WCAG 2.5.8 exception)
      if (el.tagName === "A" && st.display === "inline" && el.closest("p,li")) continue;
      if (r.width < min || r.height < min) {
        const name = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || el.getAttribute("name") || el.tagName).toString().trim().slice(0, 40).replace(/\n/g, " ");
        out.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  }, min);
}

export async function axe(page) {
  try {
    const has = await page.evaluate(() => typeof window.axe !== "undefined");
    if (!has) await page.addScriptTag({ path: AXE });
    const r = await page.evaluate(async () => {
      const res = await window.axe.run(document, { resultTypes: ["violations"] });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
    });
    return r;
  } catch (e) {
    return [{ id: "AXE_ERROR", help: String(e).slice(0, 200) }];
  }
}

export function save(name, obj) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(obj, null, 2));
}
export function load(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch { return null; }
}

export async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

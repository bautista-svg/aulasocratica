// Verifica las correcciones "globales" de la auditoría UI (D02, D03, D05, D08, D14, D17, D18,
// D23–D25, D27–D29, D32, D37, D39) contra el servidor de desarrollo.
// Uso: node docs/informes/auditoria-ui/correcciones/global/verificar-global.mjs
// Requiere: npm run dev (web :5173, API :3000) o BASE=<otra web>. Crea espacios de prueba descartables.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { overflow, smallTargets, axe } from "../../scripts/lib.mjs";

// BASE=http://localhost:5181 to use an isolated web+API pair while the shared dev API restarts.
const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const R = {};
const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const rnd = () => Math.random().toString(36).slice(2, 10);
/** Runs one check; a failure is recorded (with a screenshot) instead of stopping the whole run. */
async function step(name, page, fn) {
  try {
    await fn();
  } catch (e) {
    R[`ERROR_${name}`] = String(e?.message ?? e).split(/\r?\n/)[0];
    try {
      await shot(page, `ERROR-${name}`);
    } catch {
      /* page gone */
    }
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
async function ctx({ width = 1440, height = 900, mobile = false } = {}) {
  const c = await browser.newContext({
    viewport: { width, height },
    locale: "es-AR",
    bypassCSP: true,
    acceptDownloads: true,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  return c;
}
function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`${label}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`${label}: pageerror ${String(e).slice(0, 200)}`));
}
async function api(page, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: { "x-aula-client": "1", "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { method, url, body },
  );
}
async function startWorkspace(page) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Empezar sin cuenta" }).click();
  await page.waitForURL(/\/app/);
  await page.waitForLoadState("networkidle");
}
const ariaCurrent = (page) => page.$$eval("[aria-current=page]", (els) => els.filter((e) => e.getClientRects().length).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()));
const activeDesc = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}:${(a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 40)}` : "none";
  });

// ───────────────────────── Teacher workspace with data ─────────────────────────
const desk = await ctx();
const p = await desk.newPage();
watch(p, "desk");
await startWorkspace(p);
const LONG = "Fracciones equivalentes: comparación y ordenamiento en la recta numérica con ejemplos de la vida cotidiana";
const room = (await api(p, "POST", "/api/classrooms", { name: "Aula verificación global", subject: "Matemática", grade: "5.º", division: "B" })).json.classroom;
const act = (await api(p, "POST", "/api/activities", { classroomId: room.id, title: LONG })).json.activity;
await api(p, "PATCH", `/api/activities/${act.id}`, { instructions: "Ordená las fracciones y explicá cómo lo pensaste." });
R.publish = (await api(p, "POST", `/api/activities/${act.id}/publish`)).status;

await step("D17_D18", p, async () => {
  // D17 / D18 on /app (desktop)
  await p.goto(BASE + "/app", { waitUntil: "networkidle" });
  R.D17_title_inicio = await p.title();
  R.D18_current_en_inicio = await ariaCurrent(p);
  await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
  R.D18_current_en_aulas = await ariaCurrent(p);
  await p.goto(BASE + "/app/informes", { waitUntil: "networkidle" });
  R.D18_current_en_informes = await ariaCurrent(p);
});

await step("D05_inicio", p, async () => {
  // D05 — keyboard: "Nueva aula" on Inicio → Escape → focus back on the button
  await p.goto(BASE + "/app", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Nueva aula" }).first().focus();
  await p.keyboard.press("Enter");
  await p.getByRole("dialog").waitFor();
  await p.keyboard.press("Escape");
  await sleep(300);
  R.D05_foco_tras_escape_nueva_aula = await activeDesc(p);
  // mouse + "Cancelar"
  await p.getByRole("button", { name: "Nueva aula" }).first().click();
  await p.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await sleep(300);
  R.D05_foco_tras_cancelar_con_mouse = await activeDesc(p);
});

// Report (group) for D24/D25/D05-menu/D32
let rep = null;
rep = (await api(p, "POST", "/api/reports", { kind: "group", scope: { classroomId: room.id } })).json.report;
await step("informe", p, async () => {
  await p.goto(BASE + `/app/informes/${rep.id}`, { waitUntil: "networkidle" });
  R.D17_title_informe = await p.title();
  const pageText = await p.locator("main").innerText();
  R.D25_creado_el = pageText.match(/Creado el [^\n]*/)?.[0];
  R.D25_hay_am_pm = /a\. ?m\.|p\. ?m\./.test(pageText);
  // D32 — validate with empty sections: fields marked, focus in the first, no request
  let validateRequests = 0;
  p.on("request", (r) => {
    if (r.url().includes("/validate")) validateRequests++;
  });
  await p.getByRole("button", { name: /Validar/ }).click();
  await sleep(700);
  R.D32_validar_campos_marcados = await p.locator('main textarea[aria-invalid="true"]').count();
  R.D32_validar_foco = await p.evaluate(() => document.activeElement?.tagName + ":" + document.activeElement?.getAttribute("aria-invalid"));
  R.D32_validar_requests = validateRequests;
  await shot(p, "D32-informe-validar-incompleto-1440");
});

await step("D05_menu", p, async () => {
  // D05 — dialog opened from a menu item returns focus to the menu trigger
  await p.getByRole("button", { name: "Más opciones del informe" }).click();
  await p.getByRole("menuitem", { name: "Eliminar informe" }).click();
  await p.getByRole("alertdialog").waitFor();
  await p.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
  await sleep(300);
  R.D05_foco_tras_menu_y_confirmacion = await activeDesc(p);
  // keyboard path through the menu
  const trigger = p.getByRole("button", { name: "Más opciones del informe" });
  for (let i = 0; i < 3 && !(await p.getByRole("menu").count()); i++) {
    await trigger.press("Enter"); // opens the menu on its first item
    await sleep(400);
  }
  await p.getByRole("menu").waitFor();
  await p.keyboard.press("ArrowDown"); // "Cambiar título"
  await p.keyboard.press("Enter");
  await p.getByRole("dialog").waitFor();
  await p.keyboard.press("Escape");
  await sleep(300);
  R.D05_foco_tras_menu_teclado = await activeDesc(p);
});

await step("D24", p, async () => {
  // D24 — PDF headers: whole words
  const dl = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Descargar PDF" }).click()]);
  const pdfPath = path.join(OUT, "D24-informe.pdf");
  await dl[0].saveAs(pdfPath);
  const pdfText = execFileSync("python", [path.join(OUT, "..", "..", "scripts", "pdftext.py"), pdfPath, path.join(OUT, "D24-informe-pdf"), "1"], { encoding: "utf8" });
  R.D24_palabras_enteras = {
    Finalizaron: /\bFinalizaron\b/.test(pdfText),
    Ejemplos: /\bEjemplos\b/.test(pdfText),
    Participantes: /\bParticipantes\b/.test(pdfText),
    cortes: (pdfText.match(/\b(Finalizaro|Ejemp|Participan|Revisa)\n/g) || []).length,
  };
});

await step("D27", p, async () => {
  // D27 — toast close button in Spanish (save the workspace name)
  await p.goto(BASE + "/app/cuenta", { waitUntil: "networkidle" });
  R.D02_texto_mi_espacio = (await p.locator("main").innerText()).match(/[^\n]*alumnos[^\n]*lo ven[^\n]*/g);
  await p.getByLabel("Tu nombre o el de tu espacio").fill("Profe Verificación");
  await p.getByRole("button", { name: "Guardar", exact: true }).click();
  await p.getByText("Nombre guardado").waitFor();
  R.D27_toast_close = await p.$$eval("[data-sonner-toast] button[data-close-button]", (b) => b.map((x) => x.getAttribute("aria-label")));
  R.D27_region = await p.$eval("section[aria-live]", (s) => s.getAttribute("aria-label")).catch(() => null);
  await shot(p, "D27-toast-1440");
});

await step("D32_cuenta", p, async () => {
  // D32 — create account with an invalid email: our message, focus on the field, no browser bubble
  await p.getByLabel("Correo").fill("correo-invalido");
  await p.getByLabel("Contraseña", { exact: true }).fill("una frase bastante larga");
  await p.getByRole("button", { name: "Crear cuenta" }).click();
  await sleep(500);
  R.D32_crear_cuenta_error = await p.locator("main").innerText().then((t) => t.match(/Revisá el correo[^\n]*/)?.[0] ?? null);
  R.D32_crear_cuenta_foco = await p.evaluate(() => `${document.activeElement?.getAttribute("type")}:${document.activeElement?.getAttribute("aria-invalid")}`);
  await shot(p, "D32-cuenta-correo-invalido-1440");
});

await step("D23_D39", p, async () => {
  // D23 / D39 / D17 — missing ids and unknown routes
  for (const [k, url] of [
    ["aula", `/app/aulas/${crypto.randomUUID()}`],
    ["sesion", `/app/sesiones/${crypto.randomUUID()}`],
    ["informe", `/app/informes/${crypto.randomUUID()}`],
  ]) {
    await p.goto(BASE + url, { waitUntil: "networkidle" });
    await sleep(400);
    const t = await p.locator("main").innerText();
    R[`D23_${k}`] = { reintentar: /Reintentar/.test(t), salida: t.match(/Ir a mis aulas|Volver a Informes|Ir al inicio/g) };
    if (k === "aula") await shot(p, "D23-aula-inexistente-1440");
  }
  await p.goto(BASE + "/app/no-existe", { waitUntil: "networkidle" });
  R.D39_app_404 = {
    title: await p.title(),
    h1: await p.locator("h1").allInnerTexts(),
    mains: await p.locator("main").count(),
    logosEnMain: await p.locator('main svg[viewBox="0 0 64 64"]').count(),
  };
  await shot(p, "D39-404-dentro-de-app-1440");
});

const anon = await ctx({ width: 375, height: 812, mobile: true });
const a404 = await anon.newPage();
watch(a404, "anon");
await step("publicas", a404, async () => {
  // PUBLIC_START
  await a404.goto(BASE + "/no-existe-esta-ruta", { waitUntil: "networkidle" });
  R.D39_404_publica = { title: await a404.title(), h1: await a404.locator("h1").allInnerTexts(), axe: await axe(a404) };
  await shot(a404, "D39-404-publica-375");
  await a404.goto(BASE + "/app", { waitUntil: "networkidle" });
  R.D17_sin_espacio = await a404.title();
  await a404.goto(BASE + "/ingresar?modo=recuperar", { waitUntil: "networkidle" });
  R.D18_current_recuperar = await ariaCurrent(a404);
  // D32 — recover with empty fields: messages, no disabled button
  await a404.getByRole("button", { name: "Crear contraseña nueva" }).click();
  await sleep(400);
  R.D32_recuperar_errores = await a404.locator('[aria-invalid="true"]').count();
  await shot(a404, "D32-recuperar-vacio-375");
});

await step("D14", p, async () => {
  // D14 — contrast in notices and disabled switches (Aula → Alertas uses the locked Switch)
  await p.goto(BASE + `/app/aulas/${room.id}`, { waitUntil: "networkidle" });
  const alertTab = p.getByRole("tab", { name: /Alertas/ });
  if (await alertTab.count()) {
    await alertTab.click();
    await sleep(600);
    R.D14_axe_alertas = (await axe(p)).filter((v) => v.id === "color-contrast");
    const sw = p.locator('button[role="switch"]').first();
    const box = await sw.boundingBox();
    // the visible switch is 28 px tall; the touch target reaches 44 px
    R.D37_switch_hit_area = await p.evaluate(({ x, y, h }) => {
      const top = document.elementFromPoint(x, y - h / 2 - 7);
      const bot = document.elementFromPoint(x, y + h / 2 + 7);
      return { arriba: top?.getAttribute("role"), abajo: bot?.getAttribute("role") };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2, h: box.height });
  }
  await api(p, "PATCH", `/api/reports/${rep.id}`, { narrative: { shared_difficulties: "Texto", evidence: "Texto", recommendations: "Texto" } });
  await api(p, "POST", `/api/reports/${rep.id}/validate`);
  await p.goto(BASE + `/app/informes/${rep.id}`, { waitUntil: "networkidle" });
  R.D14_axe_informe_validado = (await axe(p)).filter((v) => v.id === "color-contrast");
  R.D25_validado_el = (await p.locator("main").innerText()).match(/Validado el [^\n]*/)?.[0];
});

await step("responsive", p, async () => {
  // ───────────────────────── Mobile layouts (320 / 375) + 1440 shots ─────────────────────────
  const state = await desk.storageState();
  for (const width of [320, 375, 1440]) {
    const c = await browser.newContext({
      viewport: { width, height: width === 1440 ? 900 : 812 },
      locale: "es-AR",
      bypassCSP: true,
      storageState: state,
      ...(width < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    });
    const m = await c.newPage();
    watch(m, `w${width}`);
    for (const [key, url] of [
      ["inicio", "/app"],
      ["informes", "/app/informes"],
      ["informe", `/app/informes/${rep.id}`],
      ["cuenta", "/app/cuenta"],
    ]) {
      await m.goto(BASE + url, { waitUntil: "networkidle" });
      await sleep(300);
      const ov = await overflow(m);
      R[`overflow_${key}_${width}`] = ov.overflow ? ov : false;
      if (width === 375) R[`small_${key}_375`] = await smallTargets(m);
      if (width === 375 && key === "inicio") R.D18_current_movil_inicio = await ariaCurrent(m);
      await shot(m, `${key}-${width}`, width !== 1440 && key === "inicio");
    }
    await c.close();
  }
  // public screens at 375
  const pub = await ctx({ width: 375, height: 812, mobile: true });
  const pp = await pub.newPage();
  watch(pp, "pub");
  for (const [key, url] of [
    ["landing", "/"],
    ["ingresar", "/ingresar"],
    ["recuperar", "/ingresar?modo=recuperar"],
    ["privacidad", "/privacidad"],
  ]) {
    await pp.goto(BASE + url, { waitUntil: "networkidle" });
    R[`small_${key}_375`] = await smallTargets(pp);
    R[`overflow_${key}_375`] = (await overflow(pp)).overflow;
  }
});

// ───────────────────────── D28 — admin panel (API mocked: no credentials needed) ─────────────────────────
const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(8 + i).padStart(2, "0")}`, calls: 30 + i, failed: 0, inputTokens: 120000 + i * 9000, outputTokens: 30000 + i * 2000, costUsd: 0.03 }));
const overviewMock = {
  totals: { workspaces: 12, withAccount: 4, active7: 6, active30: 9, suspended: 1, classrooms: 20, activities: 48, published: 30, studentSessions: 410, messages7: 2200 },
  ai: {
    days,
    byPurpose: [
      { purpose: "tutor_chat", calls: 300, inputTokens: 1800000, outputTokens: 400000, costUsd: 0.38 },
      { purpose: "report_narrative", calls: 4, inputTokens: 40000, outputTokens: 9000, costUsd: 0.01 },
    ],
    totalCostUsd: 0.39,
    pricePerMTok: { input: 0.1, output: 0.5 },
    dailyUsdPerWorkspace: 2,
    dailyUsdGlobal: 30,
  },
};
const wsMock = {
  workspaces: Array.from({ length: 4 }, (_, i) => ({
    id: crypto.randomUUID(),
    shortId: `a1b2c${i}`,
    createdAt: "2026-10-01T12:00:00.000Z",
    lastSeenAt: "2026-10-21T12:00:00.000Z",
    hasAccount: i % 2 === 0,
    maskedEmail: i % 2 === 0 ? "d***@e***.com" : null,
    classrooms: 3,
    activities: 7,
    studentSessions: 54,
    aiUsdToday: 0.12,
    suspended: i === 3,
  })),
  nextCursor: null,
};
for (const width of [320, 375, 430, 1440]) {
  const c = await ctx({ width, height: 900, mobile: width < 768 });
  await c.route("**/api/admin/session", (r) => r.fulfill({ json: { authenticated: true } }));
  await c.route("**/api/admin/overview", (r) => r.fulfill({ json: overviewMock }));
  await c.route("**/api/admin/workspaces*", (r) => r.fulfill({ json: wsMock }));
  const m = await c.newPage();
  watch(m, `admin${width}`);
  await m.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await sleep(300);
  const ov = await overflow(m);
  const t = await m.locator("body").innerText();
  R[`D28_admin_${width}`] = {
    overflow: ov.overflow ? ov : false,
    h1: await m.locator("h1").allInnerTexts(),
    soloLectura: /solo lectura/i.test(t),
    ...(width === 375 ? { axe: (await axe(m)).map((v) => v.id), small: await smallTargets(m) } : {}),
  };
  await shot(m, `D28-admin-${width}`, width < 768);
  await c.close();
}

let devB, B;
await step("D08", p, async () => {
  // ───────────────────────── D08 — session closed on another device ─────────────────────────
  const devA = await ctx({ width: 390, height: 844, mobile: true });
  const A = await devA.newPage();
  watch(A, "devA");
  await startWorkspace(A);
  const email = `verificacion-${rnd()}@example.test`;
  const pass1 = `clave de prueba ${rnd()} ${rnd()}`;
  const pass2 = `otra clave de prueba ${rnd()} ${rnd()}`;
  R.D08_registro = (await api(A, "POST", "/api/auth/register", { email, password: pass1 })).status;
  await A.goto(BASE + "/app", { waitUntil: "networkidle" });
  devB = await ctx();
  B = await devB.newPage();
  await B.goto(BASE + "/ingresar", { waitUntil: "networkidle" });
  R.D08_login_B = (await api(B, "POST", "/api/auth/login", { email, password: pass1 })).status;
  R.D08_cambio_clave_B = (await api(B, "POST", "/api/auth/password", { currentPassword: pass1, newPassword: pass2 })).status;
  // On A, without reloading: try to create a classroom
  await A.getByRole("button", { name: "Nueva aula" }).first().click();
  await A.getByRole("dialog").getByLabel("Nombre del aula").fill("Aula que no se guarda");
  await A.getByRole("dialog").getByRole("button", { name: "Crear aula" }).click();
  await A.getByRole("heading", { name: "Tu sesión se cerró en este dispositivo" }).waitFor({ timeout: 8000 }).catch(() => {});
  const tA = await A.locator("body").innerText();
  R.D08_pantalla = {
    titulo: /Tu sesión se cerró en este dispositivo/.test(tA),
    explica: /cambiado o recuperado la contraseña en otro dispositivo/.test(tA),
    primeraAccion: await A.locator("main a, main button").first().innerText(),
    title: await A.title(),
  };
  await shot(A, "D08-sesion-cerrada-390");
  // after a reload, signing in is still the first option
  await A.reload({ waitUntil: "networkidle" });
  R.D08_tras_recargar_primeraAccion = await A.locator("main a, main button").first().innerText();
  await shot(A, "D08-sesion-cerrada-recarga-390");
});

// ───────────────────────── D29 — sign out / delete workspace ─────────────────────────
await step("D29", p, async () => {
  // D29_START
  await B.goto(BASE + "/app/cuenta", { waitUntil: "networkidle" });
  await B.getByRole("button", { name: "Cerrar sesión" }).click();
  await B.waitForURL(BASE + "/");
  await sleep(600);
  const tB = await B.locator("body").innerText();
  R.D29_tras_cerrar_sesion = { miEspacio: /Mi espacio|Abrir mi espacio/.test(tB), empezar: /Empezar sin cuenta/.test(tB), toast: /Sesión cerrada en este dispositivo/.test(tB) };
  await shot(B, "D29-tras-cerrar-sesion-1440");
  const devC = await ctx();
  const C = await devC.newPage();
  watch(C, "devC");
  await startWorkspace(C);
  await C.goto(BASE + "/app/cuenta", { waitUntil: "networkidle" });
  await C.getByRole("button", { name: "Borrar mi espacio" }).click();
  await C.getByRole("alertdialog").getByRole("textbox").fill("BORRAR");
  await C.getByRole("alertdialog").getByRole("button", { name: "Borrar para siempre" }).click();
  await C.waitForURL(BASE + "/");
  await sleep(600);
  const tC = await C.locator("body").innerText();
  R.D29_tras_borrar = { miEspacio: /Mi espacio|Abrir mi espacio/.test(tC), empezar: /Empezar sin cuenta/.test(tC), toast: /Tu espacio se borró/.test(tC) };
  await shot(C, "D29-tras-borrar-espacio-1440");
});

R.consoleErrors = consoleErrors;
fs.writeFileSync(path.join(OUT, "resultado.json"), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
await browser.close();

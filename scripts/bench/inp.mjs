// Lab INP: drives real interactions with Playwright (Chrome, 412x823 viewport, 4x CPU throttling via
// CDP, no network throttling) and reads Event Timing entries (PerformanceObserver type "event",
// durationThreshold 16 ms). Per scenario and run: INP = longest interaction (fewer than 50
// interactions), plus p75 and the input-delay / processing / presentation split of the worst one.
// Scenarios: student chat (typing + sending a message to the local AI simulator), teacher live view
// (filters, tabs, period select) and classroom page (tabs). Writes docs/benchmarks/inp-<label>.json.
// Usage: node scripts/bench/inp.mjs <label> <runs> [baseUrl] [seedInfo]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [label, runsArg, baseArg, seedArg] = process.argv.slice(2);
if (!label) {
  console.error("Usage: node scripts/bench/inp.mjs <label> <runs> [baseUrl] [seedInfo]");
  process.exit(1);
}
const runs = Number(runsArg ?? 3);
const base = baseArg ?? "http://localhost:4500";
const seed = JSON.parse(fs.readFileSync(seedArg ?? "data-perf/seed-info.json", "utf8")).main;
const teacherToken = seed.cookie.split("=")[1];

const observer = () => {
  window.__events = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.interactionId) continue;
      window.__events.push({
        name: e.name,
        id: e.interactionId,
        duration: e.duration,
        inputDelay: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        presentation: e.startTime + e.duration - e.processingEnd,
        target: e.target ? (e.target.getAttribute("aria-label") || e.target.textContent || e.target.id || e.target.tagName).trim().slice(0, 40) : null,
      });
    }
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
};

function summarize(events) {
  // One value per interaction: the longest event of that interaction.
  const byId = new Map();
  for (const e of events) if (!byId.has(e.id) || byId.get(e.id).duration < e.duration) byId.set(e.id, e);
  const list = [...byId.values()].sort((a, b) => a.duration - b.duration);
  const worst = list.at(-1) ?? null;
  const p75 = list.length ? list[Math.min(list.length - 1, Math.ceil(0.75 * list.length) - 1)].duration : 0;
  return {
    interactionsOver16ms: list.length,
    inpMs: worst ? worst.duration : 0,
    p75Ms: p75,
    top: list.slice(-5).reverse().map((e) => `${Math.round(e.duration)}ms ${e.name} «${e.target ?? ""}»`),
    worst: worst && {
      name: worst.name,
      inputDelay: Math.round(worst.inputDelay),
      processing: Math.round(worst.processing),
      presentation: Math.round(worst.presentation),
    },
  };
}

async function newPage(browser, cookies) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: false, hasTouch: false });
  if (cookies.length) await ctx.addCookies(cookies);
  await ctx.addInitScript(observer);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { ctx, page };
}

const SCENARIOS = {
  async "student-chat"(browser, run) {
    const active = seed.studentLinks.filter((l) => l.inProgress);
    const s = active[run % active.length];
    const [name, value] = s.cookie.split("=");
    const { ctx, page } = await newPage(browser, [{ name, value, domain: "localhost", path: "/api/s", httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/clase/${s.link}`, { waitUntil: "networkidle" });
    const box = page.locator("#composer");
    await box.waitFor();
    await box.click();
    await page.keyboard.type("Creo que la planta usa la luz para fabricar su alimento", { delay: 60 });
    await page.keyboard.press("Enter");
    // Wait until the reply finished streaming (the composer is enabled again).
    await page.waitForFunction(() => !document.querySelector('button[type="submit"][aria-label^="Esperá"]'), null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    await box.click();
    await page.keyboard.type("y también agua", { delay: 60 });
    await page.waitForTimeout(800);
    const events = await page.evaluate(() => window.__events);
    await ctx.close();
    return summarize(events);
  },

  async "teacher-live"(browser) {
    const { ctx, page } = await newPage(browser, [{ name: "as_t", value: teacherToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/app/actividades/${seed.liveActivityId}?tab=en-vivo`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Quién hizo esta actividad" }).waitFor();
    for (let round = 0; round < 2; round++) {
      for (const f of ["Trabajando", "Necesitan apoyo", "Terminaron", "Todos"]) {
        await page.getByRole("group", { name: "Filtrar alumnos" }).getByRole("button", { name: new RegExp(`^${f}`) }).click();
        await page.waitForTimeout(250);
      }
    }
    const tiempo = page.getByRole("tab", { name: "Actividad en el tiempo" });
    if (await tiempo.count()) {
      await tiempo.click();
      await page.waitForTimeout(300);
    }
    await page.getByRole("tab", { name: "Configuración" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("tab", { name: "En vivo" }).click();
    await page.waitForTimeout(800);
    const events = await page.evaluate(() => window.__events);
    await ctx.close();
    return summarize(events);
  },

  async "teacher-classroom"(browser) {
    const { ctx, page } = await newPage(browser, [{ name: "as_t", value: teacherToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.goto(`${base}/app/aulas/${seed.classroomId}`, { waitUntil: "networkidle" });
    for (const t of ["Alumnos", "Alertas", "Actividades", "Alumnos", "Actividades"]) {
      await page.getByRole("tab", { name: new RegExp(`^${t}`) }).click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
    }
    const events = await page.evaluate(() => window.__events);
    await ctx.close();
    return summarize(events);
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const out = { label, date: new Date().toISOString(), runs, settings: "Chrome (Playwright), 412x823, CPU 4x via CDP, no network throttling, Event Timing durationThreshold 16 ms", chrome: browser.version(), scenarios: {} };
for (const [name, fn] of Object.entries(SCENARIOS)) {
  if (process.env.SCENARIOS && !process.env.SCENARIOS.split(",").includes(name)) continue;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const r = await fn(browser, i);
    samples.push(r);
    console.log(name, `run ${i + 1}/${runs}`, JSON.stringify(r));
  }
  const med = (k) => {
    const v = samples.map((s) => s[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  out.scenarios[name] = { medianInpMs: med("inpMs"), medianP75Ms: med("p75Ms"), maxInpMs: Math.max(...samples.map((s) => s.inpMs)), samples };
}
await browser.close();
const dir = path.resolve("docs/benchmarks");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `inp-${label}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.scenarios).map(([k, v]) => [k, { medianInpMs: v.medianInpMs, maxInpMs: v.maxInpMs }]))));

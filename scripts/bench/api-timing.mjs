// Loads each URL N times in a fresh Chrome context and records the timing of
// same-origin API calls (fetch/xhr) the page makes, plus navigation timings.
// Usage: node scripts/bench/api-timing.mjs <label> <runs> <apiPathRegex> <url> [url...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [label, runsArg, apiPattern, ...urls] = process.argv.slice(2);
const runs = Number(runsArg);
const apiRe = new RegExp(apiPattern);

const pct = (values, p) => {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1);
  return Math.round(v[idx]);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const out = { label, date: new Date().toISOString(), runsPerUrl: runs, apiPattern, urls: {} };

for (const url of urls) {
  const apiDurations = [];
  const nav = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const started = new Map();
    page.on("request", (r) => {
      if (["fetch", "xhr"].includes(r.resourceType()) && apiRe.test(r.url())) started.set(r, Date.now());
    });
    page.on("requestfinished", async (r) => {
      if (!started.has(r)) return;
      const t = r.timing();
      // responseEnd is relative to startTime; fall back to wall clock.
      const d = t.responseEnd > 0 ? t.responseEnd : Date.now() - started.get(r);
      apiDurations.push(d);
    });
    await page.goto(url, { waitUntil: "networkidle" });
    const timing = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { ttfb: n.responseStart - n.requestStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd };
    });
    const mem = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
    nav.push({ ...timing, jsHeapBytes: mem });
    await ctx.close();
  }
  out.urls[url] = {
    apiCalls: apiDurations.length,
    apiP50Ms: pct(apiDurations, 50),
    apiP95Ms: pct(apiDurations, 95),
    navTtfbP50Ms: pct(nav.map((n) => n.ttfb), 50),
    domContentLoadedP50Ms: pct(nav.map((n) => n.domContentLoaded), 50),
    loadP50Ms: pct(nav.map((n) => n.load), 50),
    jsHeapP50Bytes: pct(nav.map((n) => n.jsHeapBytes ?? 0), 50),
  };
  console.log(url, JSON.stringify(out.urls[url]));
}
await browser.close();
const dir = path.resolve("docs/benchmarks");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `api-timing-${label}.json`), JSON.stringify(out, null, 2));

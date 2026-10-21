// Like lighthouse.mjs (same metrics, same mobile defaults: Moto G Power emulation, simulated slow 4G
// 150 ms RTT / 1.6 Mbps, 4x CPU) but for a list of named pages, some of them with a cookie (teacher
// workspace or student device) sent through Lighthouse's extraHeaders. Pages come from the seed
// (data-perf/seed-info.json). Writes docs/benchmarks/lighthouse-<label>.json.
// Usage: node scripts/bench/lighthouse-pages.mjs <label> <runs> [baseUrl] [seedInfo]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const [label, runsArg, baseArg, seedArg] = process.argv.slice(2);
if (!label || !runsArg) {
  console.error("Usage: node scripts/bench/lighthouse-pages.mjs <label> <runs> [baseUrl] [seedInfo]");
  process.exit(1);
}
const runs = Number(runsArg);
const base = baseArg ?? "http://localhost:4500";
const seed = JSON.parse(fs.readFileSync(seedArg ?? "data-perf/seed-info.json", "utf8")).main;
const student = seed.studentLinks[0];

export const PAGES = [
  { name: "landing", path: "/" },
  { name: "ingresar", path: "/ingresar" },
  { name: "clase-inexistente", path: "/clase/token-inexistente" },
  { name: "clase-ingreso", path: `/clase/${seed.liveLinkToken}` },
  { name: "clase-chat", path: `/clase/${student.link}`, cookie: student.cookie },
  { name: "app-inicio", path: "/app", cookie: seed.cookie },
  { name: "app-aula", path: `/app/aulas/${seed.classroomId}`, cookie: seed.cookie },
  { name: "app-actividad-en-vivo", path: `/app/actividades/${seed.liveActivityId}?tab=en-vivo`, cookie: seed.cookie },
];
const only = process.env.PAGES ? process.env.PAGES.split(",") : null;

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

function extract(lhr) {
  const a = lhr.audits;
  const items = a["network-requests"]?.details?.items ?? [];
  const sumType = (t) => items.filter((i) => i.resourceType === t).reduce((s, i) => s + (i.transferSize ?? 0), 0);
  return {
    performanceScore: lhr.categories.performance?.score ?? null,
    accessibilityScore: lhr.categories.accessibility?.score ?? null,
    bestPracticesScore: lhr.categories["best-practices"]?.score ?? null,
    seoScore: lhr.categories.seo?.score ?? null,
    fcpMs: a["first-contentful-paint"]?.numericValue ?? null,
    lcpMs: a["largest-contentful-paint"]?.numericValue ?? null,
    cls: a["cumulative-layout-shift"]?.numericValue ?? null,
    tbtMs: a["total-blocking-time"]?.numericValue ?? null,
    speedIndexMs: a["speed-index"]?.numericValue ?? null,
    ttfbMs: a["server-response-time"]?.numericValue ?? null,
    interactiveMs: a["interactive"]?.numericValue ?? null,
    mainThreadMs: a["mainthread-work-breakdown"]?.numericValue ?? null,
    bootupMs: a["bootup-time"]?.numericValue ?? null,
    totalTransferBytes: a["total-byte-weight"]?.numericValue ?? null,
    jsTransferBytes: sumType("Script"),
    cssTransferBytes: sumType("Stylesheet"),
    fontTransferBytes: sumType("Font"),
    fetchTransferBytes: sumType("Fetch") + sumType("XHR"),
    requests: items.length,
    scriptRequests: items.filter((i) => i.resourceType === "Script").length,
  };
}

const chromePath =
  process.env.CHROME_PATH ??
  (os.platform() === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined);

const results = {
  label,
  date: new Date().toISOString(),
  runsPerUrl: runs,
  machine: { platform: os.platform(), release: os.release(), cpus: os.cpus()[0]?.model, cpuCount: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9), node: process.version },
  settings: "Lighthouse default mobile: Moto G Power emulation, simulated throttling (150ms RTT, 1.6Mbps down, 4x CPU); fresh Chrome per run (cold cache)",
  pages: {},
};

for (const page of PAGES) {
  if (only && !only.includes(page.name)) continue;
  const url = base + page.path;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ["--headless=new", "--no-sandbox"] });
    try {
      const r = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        ...(page.cookie ? { extraHeaders: { Cookie: page.cookie } } : {}),
      });
      if (i === 0) results.lighthouseVersion = r.lhr.lighthouseVersion;
      if (i === 0) results.chromeVersion = r.lhr.environment?.hostUserAgent;
      samples.push({ ...extract(r.lhr), finalUrl: r.lhr.finalDisplayedUrl });
      process.stdout.write(`${page.name} run ${i + 1}/${runs} LCP=${Math.round(samples.at(-1).lcpMs)}ms TBT=${Math.round(samples.at(-1).tbtMs)}ms\n`);
    } finally {
      await chrome.kill();
    }
  }
  const keys = Object.keys(samples[0]).filter((k) => typeof samples[0][k] === "number");
  results.pages[page.name] = { url: base + page.path.replace(/\/clase\/[^/?]+/, "/clase/<token>").replace(/[0-9a-f-]{36}/g, "<id>"), cookie: Boolean(page.cookie), median: Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))])), samples };
}

const outDir = path.resolve("docs/benchmarks");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `lighthouse-${label}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Saved ${out}`);

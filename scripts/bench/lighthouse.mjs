// Runs Lighthouse (mobile, simulated slow 4G + 4x CPU throttling — Lighthouse defaults)
// N times per URL and writes the median of each metric to a JSON file.
// Usage: node scripts/bench/lighthouse.mjs <label> <runs> <url> [url...]
// Requires `lighthouse` (devDependency) and a local Chrome/Chromium (CHROME_PATH).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const [label, runsArg, ...urls] = process.argv.slice(2);
if (!label || !runsArg || urls.length === 0) {
  console.error("Usage: node scripts/bench/lighthouse.mjs <label> <runs> <url> [url...]");
  process.exit(1);
}
const runs = Number(runsArg);

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

function extract(lhr) {
  const a = lhr.audits;
  const items = a["network-requests"]?.details?.items ?? [];
  const jsTransfer = items
    .filter((i) => i.resourceType === "Script")
    .reduce((sum, i) => sum + (i.transferSize ?? 0), 0);
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
    totalTransferBytes: a["total-byte-weight"]?.numericValue ?? null,
    jsTransferBytes: jsTransfer,
    requests: items.length,
  };
}

const chromePath =
  process.env.CHROME_PATH ??
  (os.platform() === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined);

const results = { label, date: new Date().toISOString(), runsPerUrl: runs, machine: {
  platform: os.platform(), cpus: os.cpus()[0]?.model, cpuCount: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9),
}, settings: "Lighthouse default mobile: Moto G Power emulation, simulated throttling (150ms RTT, 1.6Mbps down, 4x CPU)", urls: {} };

for (const url of urls) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ["--headless=new", "--no-sandbox"] });
    try {
      const r = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      samples.push(extract(r.lhr));
      process.stdout.write(`${url} run ${i + 1}/${runs} LCP=${Math.round(samples.at(-1).lcpMs)}ms\n`);
    } finally {
      await chrome.kill();
    }
  }
  const keys = Object.keys(samples[0]);
  results.urls[url] = { median: Object.fromEntries(keys.map((k) => [k, median(samples.map((s) => s[k]))])), samples };
}

const outDir = path.resolve("docs/benchmarks");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `lighthouse-${label}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`Saved ${out}`);

// TBT only counts long tasks between FCP and TTI: when FCP moves earlier, tasks that used to happen
// before FCP start counting. This measures, with the same Lighthouse settings, the blocking time of
// ALL long tasks of the load (sum of duration − 50 ms) next to TBT, for the teacher pages.
// Writes docs/benchmarks/long-tasks-<label>.json. Usage: node scripts/bench/long-tasks.mjs <label> <runs>
import fs from "node:fs";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const [label, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const seed = JSON.parse(fs.readFileSync("data-perf/seed-info.json", "utf8")).main;
const pages = {
  "app-inicio": "/app",
  "app-aula": `/app/aulas/${seed.classroomId}`,
  "app-actividad-en-vivo": `/app/actividades/${seed.liveActivityId}?tab=en-vivo`,
  "clase-chat": `/clase/${seed.studentLinks[0].link}`,
};
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const out = { label, date: new Date().toISOString(), runs, pages: {} };
for (const [name, path] of Object.entries(pages)) {
  const cookie = name === "clase-chat" ? seed.studentLinks[0].cookie : seed.cookie;
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const chrome = await chromeLauncher.launch({ chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", chromeFlags: ["--headless=new", "--no-sandbox"] });
    try {
      const r = await lighthouse(`http://localhost:4500${path}`, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance"], extraHeaders: { Cookie: cookie } });
      const a = r.lhr.audits;
      const tasks = a["long-tasks"].details.items;
      samples.push({
        tbtMs: a["total-blocking-time"].numericValue,
        fcpMs: a["first-contentful-paint"].numericValue,
        ttiMs: a.interactive.numericValue,
        longTasks: tasks.length,
        longTaskMs: tasks.reduce((s, t) => s + t.duration, 0),
        allBlockingMs: tasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0),
      });
    } finally {
      await chrome.kill();
    }
  }
  const keys = Object.keys(samples[0]);
  out.pages[name] = { median: Object.fromEntries(keys.map((k) => [k, Math.round(median(samples.map((s) => s[k])))])), samples };
  console.log(name, JSON.stringify(out.pages[name].median));
}
fs.writeFileSync(`docs/benchmarks/long-tasks-${label}.json`, JSON.stringify(out, null, 2));

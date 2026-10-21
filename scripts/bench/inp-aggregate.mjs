// Pools the INP runs of several blocks (inp-<label>-<n>.json from inp-compare.sh) into
// docs/benchmarks/inp-<label>-pooled.json: per scenario, the median, p75 and max of the INP of
// every run. Usage: node scripts/bench/inp-aggregate.mjs <label> <dir with the json files>
import fs from "node:fs";
import path from "node:path";

const [label, dir] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => new RegExp(`^inp-${label}-\\d+\\.json$`).test(f));
const runs = {};
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const [s, v] of Object.entries(j.scenarios)) (runs[s] ??= []).push(...v.samples.map((x) => x.inpMs));
}
const q = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const out = {
  label,
  date: new Date().toISOString(),
  blocks: files.length,
  settings: "Bloques alternados A/B (inp-compare.sh); cada bloque: seed nuevo, servidor nuevo, N corridas por escenario",
  scenarios: Object.fromEntries(Object.entries(runs).map(([s, v]) => [s, { runs: v.length, medianInpMs: q(v, 0.5), p75InpMs: q(v, 0.75), maxInpMs: Math.max(...v), all: v }])),
};
fs.writeFileSync(`docs/benchmarks/inp-${label}-pooled.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.scenarios).map(([k, v]) => [k, { n: v.runs, median: v.medianInpMs, p75: v.p75InpMs, max: v.maxInpMs }]))));

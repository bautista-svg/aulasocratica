// Bundle report from an analysis build (scripts/bench/vite-analyze.config.ts): what the entry chunk
// contains (by package) and, per route, the JS a first visit downloads (entry + the route's chunk
// and their static imports), raw and Brotli. Writes docs/benchmarks/bundle-<label>.json.
// Usage:
//   ANALYZE_OUT=<dir> ANALYZE_JSON=<dir>/bundle.json npx vite build -c scripts/bench/vite-analyze.config.ts
//   node scripts/bench/bundle-report.mjs <label> <dir>/bundle.json <dir>/assets
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [label, bundleFile, assetsDir] = process.argv.slice(2);
const b = JSON.parse(fs.readFileSync(bundleFile, "utf8"));
const size = (f) => {
  const p = path.join(assetsDir, path.basename(f));
  const raw = fs.readFileSync(p);
  return { raw: raw.length, br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
};
const closure = (start) => {
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of b[f]?.imports ?? []) stack.push(i);
  }
  return seen;
};
const sum = (files) => [...files].reduce((a, f) => { const s = size(f); return { raw: a.raw + s.raw, br: a.br + s.br, files: a.files + 1 }; }, { raw: 0, br: 0, files: 0 });
const entry = Object.keys(b).find((f) => b[f].isEntry);
const byPkg = {};
for (const [id, n] of b[entry].modules) {
  const k = id.startsWith("nm:") ? `nm:${id.slice(3).split("/").slice(0, id.slice(3).startsWith("@") ? 2 : 1).join("/")}` : "app code";
  byPkg[k] = (byPkg[k] ?? 0) + n;
}
const routes = {};
for (const [f, c] of Object.entries(b)) {
  for (const [id] of c.modules) {
    const m = /^client:routes\/(.+)\.tsx\?tsr-split=component/.exec(id);
    if (m) routes[m[1]] = sum(closure([entry, f]));
  }
}
const all = Object.keys(b);
const out = {
  label,
  date: new Date().toISOString(),
  note: "raw = minified bytes; br = Brotli q11 (what the server sends, precompressed). Per route: entry chunk + route chunk + static imports.",
  entryChunk: { file: entry, ...size(entry), renderedBytesByPackage: Object.fromEntries(Object.entries(byPkg).sort((x, y) => y[1] - x[1])) },
  entryClosure: sum(closure([entry])),
  routes: Object.fromEntries(Object.entries(routes).sort()),
  allJs: { ...sum(all), chunks: all.length },
};
fs.mkdirSync("docs/benchmarks", { recursive: true });
fs.writeFileSync(`docs/benchmarks/bundle-${label}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ entry: out.entryChunk.raw, entryClosureBr: out.entryClosure.br, clase: routes["clase.$token"], index: routes.index }, null, 0));

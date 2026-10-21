// API latency under concurrency for the seeded workspace (data-perf/seed-info.json) against a
// running server, plus process memory and event-loop delay read from the server's mem-probe file.
//   1. isolated: each endpoint alone, C concurrent clients for S seconds (after a 2 s warm-up)
//   2. mixed: every endpoint round-robin, CM clients for SM seconds (memory/event loop sampled)
//   3. sequential timings of heavy mutations: report rebuild (overview / group) and journey PDF
// Writes docs/benchmarks/api-<label>.json.
// Usage: node scripts/bench/api-suite.mjs <label> <memProbeFile> [baseUrl] [seedInfo]
//   env: C (10), S (10), CM (50), SM (30)
import fs from "node:fs";
import path from "node:path";

const [label, probeFile, baseArg, seedArg] = process.argv.slice(2);
if (!label) {
  console.error("Usage: node scripts/bench/api-suite.mjs <label> <memProbeFile> [baseUrl] [seedInfo]");
  process.exit(1);
}
const base = baseArg ?? "http://localhost:4500";
const seed = JSON.parse(fs.readFileSync(seedArg ?? "data-perf/seed-info.json", "utf8")).main;
const C = Number(process.env.C ?? 10);
const S = Number(process.env.S ?? 10);
const CM = Number(process.env.CM ?? 50);
const SM = Number(process.env.SM ?? 30);
const student = seed.studentLinks.find((l) => l.inProgress) ?? seed.studentLinks[0];
const cookie = `${seed.cookie}; ${student.cookie}`;

const ENDPOINTS = {
  me: "/api/auth/me",
  dashboard: "/api/dashboard",
  classrooms: "/api/classrooms",
  "classroom-activities": `/api/classrooms/${seed.classroomId}/activities`,
  "classroom-students": `/api/classrooms/${seed.classroomId}/students`,
  activity: `/api/activities/${seed.liveActivityId}`,
  live: `/api/live/${seed.liveActivityId}?window=30m`,
  session: `/api/sessions/${seed.sessionId}`,
  radiografia: "/api/sessions?view=radiografia",
  "student-workspace": `/api/s/${student.link}`,
};

const pct = (sorted, p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10 : null);
const stats = (lat, errors, seconds) => {
  const v = [...lat].sort((a, b) => a - b);
  return { requests: v.length, errors, rps: Math.round(v.length / seconds), p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99), max: v.length ? Math.round(v.at(-1)) : null };
};

async function load(paths, concurrency, seconds) {
  const until = Date.now() + seconds * 1000;
  const res = Object.fromEntries(paths.map((p) => [p, { lat: [], errors: 0, bytes: 0 }]));
  async function worker(i) {
    let n = i;
    while (Date.now() < until) {
      const p = paths[n++ % paths.length];
      const t0 = performance.now();
      try {
        const r = await fetch(base + p, { headers: { cookie, "accept-encoding": "gzip, br" } });
        const body = await r.arrayBuffer();
        if (!r.ok) res[p].errors++;
        else {
          res[p].lat.push(performance.now() - t0);
          res[p].bytes = body.byteLength;
        }
      } catch {
        res[p].errors++;
      }
    }
  }
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  return { res, elapsed: (Date.now() - started) / 1000 };
}

const readProbe = (from, to) => {
  if (!probeFile || !fs.existsSync(probeFile)) return [];
  return fs
    .readFileSync(probeFile, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((x) => x.t >= from && x.t <= to);
};
const memSummary = (rows) =>
  rows.length
    ? {
        samples: rows.length,
        rssMaxMB: Math.round(Math.max(...rows.map((r) => r.rss)) / 1048576),
        rssAvgMB: Math.round(rows.reduce((s, r) => s + r.rss, 0) / rows.length / 1048576),
        heapUsedMaxMB: Math.round(Math.max(...rows.map((r) => r.heapUsed)) / 1048576),
        heapUsedAvgMB: Math.round(rows.reduce((s, r) => s + r.heapUsed, 0) / rows.length / 1048576),
        eventLoopP99MaxMs: Math.max(...rows.map((r) => r.elP99)),
        eventLoopP99AvgMs: Math.round((rows.reduce((s, r) => s + r.elP99, 0) / rows.length) * 10) / 10,
        eventLoopMaxMs: Math.max(...rows.map((r) => r.elMax)),
      }
    : null;

const out = { label, date: new Date().toISOString(), base, isolated: { concurrency: C, seconds: S, endpoints: {} }, mixed: null, sequential: {}, memory: {} };

const idleFrom = Date.now();
await new Promise((r) => setTimeout(r, 3000));
out.memory.idleBefore = memSummary(readProbe(idleFrom, Date.now()));

// Sanity: every endpoint answers 200.
for (const [name, p] of Object.entries(ENDPOINTS)) {
  const r = await fetch(base + p, { headers: { cookie } });
  if (!r.ok) throw new Error(`${name} ${p} -> ${r.status}`);
  out.isolated.endpoints[name] = { path: p.replace(/[0-9a-f-]{36}/g, "<id>").replace(student.link, "<token>"), responseBytes: (await r.arrayBuffer()).byteLength, encodedBytes: null };
  const z = await fetch(base + p, { headers: { cookie, "accept-encoding": "gzip" } });
  out.isolated.endpoints[name].contentEncoding = z.headers.get("content-encoding");
}

const isoFrom = Date.now();
for (const [name, p] of Object.entries(ENDPOINTS)) {
  await load([p], C, 2); // warm-up
  const { res, elapsed } = await load([p], C, S);
  Object.assign(out.isolated.endpoints[name], stats(res[p].lat, res[p].errors, elapsed));
  console.log("isolated", name, JSON.stringify(stats(res[p].lat, res[p].errors, elapsed)));
}
out.memory.isolated = memSummary(readProbe(isoFrom, Date.now()));

const mixFrom = Date.now();
const paths = Object.values(ENDPOINTS);
const { res, elapsed } = await load(paths, CM, SM);
const mixTo = Date.now();
out.mixed = { concurrency: CM, seconds: SM, throughputRps: 0, endpoints: {} };
let total = 0;
for (const [name, p] of Object.entries(ENDPOINTS)) {
  out.mixed.endpoints[name] = stats(res[p].lat, res[p].errors, elapsed);
  total += res[p].lat.length;
}
out.mixed.throughputRps = Math.round(total / elapsed);
out.memory.mixed = memSummary(readProbe(mixFrom, mixTo));
console.log("mixed", JSON.stringify(out.mixed));

// Heavy, sequential (one at a time): report rebuilds and the journey PDF.
const post = (p, body) =>
  fetch(base + p, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
async function timeIt(name, n, fn) {
  const lat = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fn();
    await r.arrayBuffer();
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    lat.push(performance.now() - t0);
  }
  out.sequential[name] = stats(lat, 0, 1);
  delete out.sequential[name].rps;
  console.log("sequential", name, JSON.stringify(out.sequential[name]));
}
const overview = await (await post("/api/reports", { kind: "overview" })).json();
const group = await (await post("/api/reports", { kind: "group", scope: { classroomId: seed.classroomId } })).json();
await timeIt("report-overview-refresh", 10, () => post(`/api/reports/${overview.report.id}/refresh`));
await timeIt("report-classroom-refresh", 10, () => post(`/api/reports/${group.report.id}/refresh`));
await timeIt("journey-pdf", 10, () => fetch(`${base}/api/sessions/${seed.sessionId}/journey.pdf`, { headers: { cookie } }));

await new Promise((r) => setTimeout(r, 3000));
const all = readProbe(0, Date.now());
out.memory.processPeak = memSummary(all);

const dir = path.resolve("docs/benchmarks");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `api-${label}.json`), JSON.stringify(out, null, 2));
console.log(`Saved docs/benchmarks/api-${label}.json`);

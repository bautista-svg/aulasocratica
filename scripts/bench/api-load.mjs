// Small load test without extra tools: N concurrent virtual users hit a list of GET
// endpoints for D seconds with a teacher cookie and report p50/p95/p99 + throughput.
// Usage: node scripts/bench/api-load.mjs <baseUrl> <cookie> <concurrency> <seconds> <path> [path...]
const [base, cookie, concArg, secArg, ...paths] = process.argv.slice(2);
if (!base || !paths.length) {
  console.error("Usage: node scripts/bench/api-load.mjs <baseUrl> <cookie> <concurrency> <seconds> <path> [path...]");
  process.exit(1);
}
const concurrency = Number(concArg ?? 10);
const seconds = Number(secArg ?? 15);
const until = Date.now() + seconds * 1000;
const results = Object.fromEntries(paths.map((p) => [p, { lat: [], errors: 0 }]));

async function worker(i) {
  let n = i;
  while (Date.now() < until) {
    const path = paths[n++ % paths.length];
    const t0 = performance.now();
    try {
      const r = await fetch(base + path, { headers: { cookie, "accept-encoding": "gzip" } });
      await r.arrayBuffer();
      if (!r.ok) results[path].errors++;
      else results[path].lat.push(performance.now() - t0);
    } catch {
      results[path].errors++;
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const elapsed = (Date.now() - started) / 1000;

const pct = (arr, p) => {
  const v = [...arr].sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] * 10) / 10 : null;
};
const out = { base, concurrency, seconds, date: new Date().toISOString(), endpoints: {} };
let total = 0;
for (const [p, r] of Object.entries(results)) {
  total += r.lat.length;
  out.endpoints[p] = { requests: r.lat.length, errors: r.errors, p50: pct(r.lat, 50), p95: pct(r.lat, 95), p99: pct(r.lat, 99) };
}
out.throughputRps = Math.round(total / elapsed);
console.log(JSON.stringify(out, null, 2));

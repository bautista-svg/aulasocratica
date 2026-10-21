// Markdown tables "Antes | Después | Variación" from two benchmark labels (docs/benchmarks/*-<label>.json).
// Usage: node scripts/bench/compare.mjs <before> <after>
import fs from "node:fs";

const [A, B] = process.argv.slice(2);
const read = (kind, label) => {
  const f = `docs/benchmarks/${kind}-${label}.json`;
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
};
const fmt = (v, unit) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "ms") return `${Math.round(v).toLocaleString("es-AR")} ms`;
  if (unit === "KB") return `${(v / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} KB`;
  if (unit === "MB") return `${Math.round(v)} MB`;
  if (unit === "cls") return v.toFixed(3);
  if (unit === "score") return String(Math.round(v * 100));
  return String(Math.round(v * 10) / 10);
};
const delta = (a, b) => {
  if (a === null || b === null || a === undefined || b === undefined) return "—";
  if (a === 0) return b === 0 ? "=" : "n/a";
  const p = ((b - a) / a) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")} %`;
};
const row = (name, a, b, unit) => `| ${name} | ${fmt(a, unit)} | ${fmt(b, unit)} | ${delta(a, b)} |`;
const head = "| Métrica | Antes | Después | Variación |\n|---|---|---|---|";

const la = read("lighthouse", A);
const lb = read("lighthouse", B);
if (la && lb) {
  for (const page of Object.keys(la.pages)) {
    const a = la.pages[page].median;
    const b = lb.pages[page]?.median ?? {};
    console.log(`\n#### ${page} (\`${la.pages[page].url}\`${la.pages[page].cookie ? ", con cookie" : ""})\n\n${head}`);
    for (const [k, label, unit] of [
      ["performanceScore", "Puntaje Performance", "score"],
      ["lcpMs", "LCP", "ms"],
      ["fcpMs", "FCP", "ms"],
      ["cls", "CLS", "cls"],
      ["tbtMs", "TBT", "ms"],
      ["speedIndexMs", "Speed Index", "ms"],
      ["ttfbMs", "TTFB (respuesta del servidor)", "ms"],
      ["jsTransferBytes", "JS transferido", "KB"],
      ["totalTransferBytes", "Peso total", "KB"],
      ["requests", "Requests", ""],
    ])
      console.log(row(label, a[k], b[k], unit));
  }
}

const ia = read("inp", A);
const ib = read("inp", B);
if (ia && ib) {
  console.log(`\n#### INP de laboratorio (mediana de ${ia.runs} corridas; peor interacción)\n\n${head}`);
  for (const s of Object.keys(ia.scenarios)) {
    console.log(row(`${s} — INP`, ia.scenarios[s].medianInpMs, ib.scenarios[s]?.medianInpMs, "ms"));
    console.log(row(`${s} — p75 de interacciones`, ia.scenarios[s].medianP75Ms, ib.scenarios[s]?.medianP75Ms, "ms"));
  }
}

const aa = read("api", A);
const ab = read("api", B);
if (aa && ab) {
  console.log(`\n#### API aislada (${aa.isolated.concurrency} clientes concurrentes, ${aa.isolated.seconds} s por endpoint)\n\n| Endpoint | p50 antes | p50 después | p95 antes | p95 después | p99 antes | p99 después | req/s antes | req/s después |\n|---|---|---|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(aa.isolated.endpoints)) {
    const w = ab.isolated.endpoints[k] ?? {};
    console.log(`| ${k} | ${fmt(v.p50, "ms")} | ${fmt(w.p50, "ms")} (${delta(v.p50, w.p50)}) | ${fmt(v.p95, "ms")} | ${fmt(w.p95, "ms")} | ${fmt(v.p99, "ms")} | ${fmt(w.p99, "ms")} | ${v.rps} | ${w.rps} (${delta(v.rps, w.rps)}) |`);
  }
  console.log(`\n#### API mixta (${aa.mixed.concurrency} clientes, ${aa.mixed.seconds} s, todos los endpoints en ronda)\n\n| Endpoint | p50 antes | p50 después | p95 antes | p95 después | p99 antes | p99 después |\n|---|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(aa.mixed.endpoints)) {
    const w = ab.mixed.endpoints[k] ?? {};
    console.log(`| ${k} | ${fmt(v.p50, "ms")} | ${fmt(w.p50, "ms")} (${delta(v.p50, w.p50)}) | ${fmt(v.p95, "ms")} | ${fmt(w.p95, "ms")} | ${fmt(v.p99, "ms")} | ${fmt(w.p99, "ms")} |`);
  }
  console.log(`\n${head}`);
  console.log(row("Throughput mixto (req/s)", aa.mixed.throughputRps, ab.mixed.throughputRps, ""));
  for (const [k, label] of [["report-overview-refresh", "Informe general: reconstruir (p50, secuencial)"], ["report-classroom-refresh", "Informe de aula: reconstruir (p50)"], ["journey-pdf", "PDF del recorrido (p50)"]])
    console.log(row(label, aa.sequential[k]?.p50, ab.sequential[k]?.p50, "ms"));
  for (const [phase, label] of [["idleBefore", "en reposo"], ["isolated", "carga aislada"], ["mixed", "carga mixta"]]) {
    const x = aa.memory[phase] ?? {};
    const y = ab.memory[phase] ?? {};
    console.log(row(`RSS máx. (${label})`, x.rssMaxMB, y.rssMaxMB, "MB"));
    console.log(row(`Heap usado máx. (${label})`, x.heapUsedMaxMB, y.heapUsedMaxMB, "MB"));
    if (phase !== "idleBefore") console.log(row(`Event loop p99 máx. (${label})`, x.eventLoopP99MaxMs, y.eventLoopP99MaxMs, "ms"));
  }
}

const ba = read("bundle", A);
const bb = read("bundle", B);
if (ba && bb) {
  console.log(`\n#### JS de la primera visita por ruta (entry + chunk de la ruta + imports estáticos)\n\n| Ruta | Antes (mín. / br) | Después (mín. / br) | Variación (br) |\n|---|---|---|---|`);
  console.log(`| chunk de entrada (index-*.js) | ${fmt(ba.entryChunk.raw, "KB")} / ${fmt(ba.entryChunk.br, "KB")} | ${fmt(bb.entryChunk.raw, "KB")} / ${fmt(bb.entryChunk.br, "KB")} | ${delta(ba.entryChunk.br, bb.entryChunk.br)} |`);
  for (const r of Object.keys(ba.routes)) {
    const x = ba.routes[r];
    const y = bb.routes[r] ?? {};
    console.log(`| ${r} | ${fmt(x.raw, "KB")} / ${fmt(x.br, "KB")} | ${fmt(y.raw, "KB")} / ${fmt(y.br, "KB")} | ${delta(x.br, y.br)} |`);
  }
}

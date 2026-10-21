// BENCHMARK ONLY. Preloaded with `node --import ./scripts/bench/mem-probe.mjs dist/server/index.mjs`:
// appends one JSON line per second to $MEM_PROBE_FILE with the process memory (RSS, heap) and the
// event-loop delay (p50/p99/max over that second). Does not touch the app's code or behaviour.
import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";

const file = process.env.MEM_PROBE_FILE;
if (file) {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;
  setInterval(() => {
    const m = process.memoryUsage();
    const line = {
      t: Date.now(),
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
      elP50: ms(h.percentile(50)),
      elP99: ms(h.percentile(99)),
      elMax: ms(h.max),
    };
    h.reset();
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
  }, 1000).unref();
}

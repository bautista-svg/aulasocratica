// Build-time resource hints.
// 1. preloadFonts: <link rel="preload" as="font"> for the two faces almost every first screen uses
//    (Fraunces for headings — the LCP element of most pages — and Figtree for body text). Without it
//    the browser only discovers them after downloading and parsing the CSS.
// 2. routePreloads: dist/route-preloads.json maps each route file (TanStack Router code-split
//    component) to the JS files it needs beyond the entry chunk. The server adds them as
//    <link rel="modulepreload"> to the HTML of matching URLs, so they download in parallel with the
//    entry instead of after it has run.
import fs from "node:fs";
import path from "node:path";
import type { Plugin, Rollup } from "vite";

const PRELOAD_FONTS = [/^assets\/fraunces-latin-wght-normal-.*\.woff2$/, /^assets\/figtree-latin-wght-normal-.*\.woff2$/];

export function preloadFonts(): Plugin {
  return {
    name: "aula-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => PRELOAD_FONTS.some((re) => re.test(f)));
        return files.map((f) => ({
          tag: "link",
          attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${f}`, crossorigin: true },
          injectTo: "head" as const,
        }));
      },
    },
  };
}

const ROUTE_COMPONENT = /[\\/]routes[\\/](.+)\.tsx\?tsr-split=component/;

export function routePreloads(): Plugin {
  let outDir = "";
  let map: Record<string, string[]> = {};
  return {
    name: "aula-route-preloads",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    generateBundle(_opts, bundle) {
      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const item of Object.values(bundle)) if (item.type === "chunk") chunks.set(item.fileName, item);
      const closure = (start: string[]) => {
        const seen = new Set<string>();
        const stack = [...start];
        while (stack.length) {
          const f = stack.pop()!;
          if (seen.has(f)) continue;
          seen.add(f);
          for (const i of chunks.get(f)?.imports ?? []) stack.push(i);
        }
        return seen;
      };
      const entry = [...chunks.values()].find((c) => c.isEntry);
      const inEntry = closure(entry ? [entry.fileName] : []);
      map = {};
      for (const c of chunks.values()) {
        for (const id of Object.keys(c.modules)) {
          const m = ROUTE_COMPONENT.exec(id);
          if (!m) continue;
          // The route chunk first, then what it imports.
          const files = [c.fileName, ...[...closure([c.fileName])].filter((f) => f !== c.fileName)];
          map[m[1]!] = files.filter((f) => !inEntry.has(f)).map((f) => `/${f}`);
        }
      }
    },
    writeBundle() {
      // Next to the client build (not inside it: it is not a public file).
      fs.writeFileSync(path.resolve(outDir, "..", "route-preloads.json"), JSON.stringify(map, null, 1));
    },
  };
}

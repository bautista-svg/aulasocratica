// Writes .br and .gz siblings for text assets at build time so the server can send
// precompressed files (no per-request compression cost for static assets).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Plugin } from "vite";

const COMPRESSIBLE = /\.(js|css|html|svg|json|txt|webmanifest)$/;

export function compressAssets(): Plugin {
  let outDir = "";
  return {
    name: "aula-compress-assets",
    apply: "build",
    configResolved(cfg) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (COMPRESSIBLE.test(entry.name)) {
            const data = fs.readFileSync(full);
            if (data.length < 1024) continue;
            fs.writeFileSync(`${full}.br`, zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
            fs.writeFileSync(`${full}.gz`, zlib.gzipSync(data, { level: 9 }));
          }
        }
      };
      if (fs.existsSync(outDir)) walk(outDir);
    },
  };
}

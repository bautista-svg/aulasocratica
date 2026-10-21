// Bundles the API server into dist/server/index.mjs, plus the isolated extraction worker
// (dist/server/extract-worker.mjs). Runtime dependencies stay external (installed with
// `npm prune --omit=dev` in the Docker image).
import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  alias: { "@shared": "./src/shared", "@server": "./src/server" },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/server/index.ts"], outfile: "dist/server/index.mjs" });
await build({ ...common, entryPoints: ["src/server/workers/extract-worker.ts"], outfile: "dist/server/extract-worker.mjs" });

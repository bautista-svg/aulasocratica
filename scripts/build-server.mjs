// Bundles the API server into dist/server/index.mjs. Runtime dependencies stay external
// (installed with `npm ci --omit=dev` in the Docker image).
import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  alias: { "@shared": "./src/shared", "@server": "./src/server" },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

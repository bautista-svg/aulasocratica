// After `vite build`: renders the public landing to static HTML so the first paint does
// not wait for JavaScript (better LCP on phones). The server sends dist/client/landing.html
// for "/" and React replaces it with the same markup when the app boots.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outDir = path.resolve("dist/client");
const tmp = path.resolve("dist/.prerender/landing.mjs");

await build({
  entryPoints: ["src/client/prerender.tsx"],
  outfile: tmp,
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  target: "node22",
  alias: { "@client": "./src/client", "@shared": "./src/shared" },
  loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
  logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const { renderLanding } = await import(pathToFileURL(tmp).href);
const html = renderLanding();
const shell = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
if (!shell.includes('<div id="root"></div>')) throw new Error("index.html sin <div id=\"root\"></div>");
// The landing is the first page most visitors see and is complete without JS: its CSS goes inline
// (no render-blocking request before the first paint) and the font preloads of the app shell are
// dropped (the text paints right away with the metric-matched fallback and swaps when the font
// arrives; preloading would compete with the first paint on slow connections).
const cssLink = /<link rel="stylesheet" crossorigin href="\/assets\/([^"]+\.css)">/;
const css = cssLink.exec(shell);
if (!css) throw new Error("index.html sin la hoja de estilos");
const inlineCss = fs.readFileSync(path.join(outDir, "assets", css[1]), "utf8").replace(/<\/style/gi, "<\\/style");
const page = shell
  .replace(css[0], () => `<style>${inlineCss}</style>`)
  .replace(/\s*<link rel="preload" as="font"[^>]*>/g, "")
  .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
fs.writeFileSync(path.join(outDir, "landing.html"), page);
const zlib = await import("node:zlib");
fs.writeFileSync(path.join(outDir, "landing.html.br"), zlib.brotliCompressSync(Buffer.from(page)));
fs.writeFileSync(path.join(outDir, "landing.html.gz"), zlib.gzipSync(Buffer.from(page), { level: 9 }));
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
console.log(`landing.html prerendered (${Math.round(page.length / 1024)} KB)`);

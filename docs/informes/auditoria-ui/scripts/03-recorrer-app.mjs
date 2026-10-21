import { launch, instrument, shot, overflow, text, BASE, save, DATA } from "./lib.mjs";
import path from "node:path";

const state = process.argv[2] || path.join(DATA, "docente-state.json");
const routes = (process.argv[3] || "/app,/app/aulas,/app/crear,/app/tutores,/app/materiales,/app/radiografia,/app/informes,/app/cuenta").split(",");
const prefix = process.argv[4] || "02";
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR", storageState: state });
const page = await ctx.newPage();
const log = [];
instrument(page, "docente", log);
for (const r of routes) {
  await page.goto(BASE + r, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, `${prefix}-${r.replace(/\//g, "_").replace(/^_/, "").replace(/\?.*/, "")}-1440`, true);
  console.log("=====", r, "->", page.url(), "|", await page.title());
  console.log((await text(page)).replace(/\n{2,}/g, "\n").slice(0, 2500));
  console.log("BTN:", await page.$$eval("button", (bs) => bs.filter(b=>b.offsetParent).map((b) => (b.innerText.trim() || "[aria]" + b.getAttribute("aria-label") || "").replace(/\n/g, " ")).join(" | ")));
  console.log("INPUTS:", await page.$$eval("input,textarea,select", (bs) => bs.filter(b=>b.offsetParent || b.type==="file").map((b) => `${b.tagName}[${b.type}] name=${b.name} id=${b.id} accept=${b.accept||""} label=${b.labels?.[0]?.innerText?.trim()?.slice(0,40) || b.getAttribute("aria-label") || b.placeholder}`).join(" | ")));
  console.log("OVERFLOW", JSON.stringify(await overflow(page)));
}
console.log("LOG", JSON.stringify(log, null, 1));
await browser.close();

import { launch, instrument, shot, overflow, text, BASE, save } from "./lib.mjs";

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR" });
const page = await ctx.newPage();
const log = [];
instrument(page, "explore", log);
const out = {};
for (const route of ["/", "/ingresar", "/privacidad", "/app", "/admin", "/clase/tokeninvalido123", "/no-existe-esta-ruta"]) {
  await page.goto(BASE + route, { waitUntil: "networkidle" }).catch((e) => console.log("goto err", route, e.message));
  await page.waitForTimeout(800);
  const name = "00-explorar" + (route === "/" ? "-home" : route.replace(/\//g, "-"));
  await shot(page, name + "-1440", true);
  out[route] = {
    finalUrl: page.url(),
    title: await page.title(),
    text: (await text(page)).slice(0, 3000),
    links: await page.$$eval("a", (as) => as.map((a) => `${a.innerText.trim().slice(0, 50)} -> ${a.getAttribute("href")}`)),
    buttons: await page.$$eval("button", (bs) => bs.map((b) => b.innerText.trim().slice(0, 50) || b.getAttribute("aria-label"))),
    overflow: await overflow(page),
  };
}
save("01-explorar.json", { out, log });
console.log(JSON.stringify(out, null, 1));
console.log("LOG", JSON.stringify(log, null, 1));
await browser.close();

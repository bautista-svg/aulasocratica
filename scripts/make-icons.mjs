// Renders the PNG icons and the social card from the SVG logo (run once; outputs are committed).
import fs from "node:fs";
import { chromium } from "@playwright/test";

const svg = fs.readFileSync("public/favicon.svg", "utf8");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function shot(file, size, { pad = 0, bg = "transparent" } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: file, omitBackground: bg === "transparent" });
}

await shot("public/icon-192.png", 192, { pad: 8 });
await shot("public/icon-512.png", 512, { pad: 20 });
await shot("public/icon-maskable-512.png", 512, { pad: 96, bg: "#f6f7fb" });
await shot("public/apple-touch-icon.png", 180, { pad: 18, bg: "#f6f7fb" });

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#f6f7fb;font-family:Georgia,serif;display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:56px">
  <div style="width:180px;height:180px;flex:none">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  <div><div style="font-size:30px;color:#5b45b8;font-family:Arial,sans-serif;font-weight:700;margin-bottom:18px">Aula Socrática</div>
  <div style="font-size:68px;line-height:1.05;color:#14295c;font-weight:700">Un tutor que pregunta <i style="color:#5b45b8;font-weight:500">en vez de responder.</i></div></div>
</body></html>`);
await page.screenshot({ path: "public/og.png" });
await browser.close();
console.log("icons ok");

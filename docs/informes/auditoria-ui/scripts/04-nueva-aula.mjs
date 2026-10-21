import { launch, instrument, shot, overflow, text, BASE, save, DATA, axe } from "./lib.mjs";
import path from "node:path";

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-AR", storageState: path.join(DATA, "docente-state.json") });
const page = await ctx.newPage();
const log = [];
instrument(page, "docente", log);
await page.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Nueva aula" }).first().click();
await page.waitForTimeout(700);
await shot(page, "03-nueva-aula-dialogo-1440");
const dlg = page.getByRole("dialog");
console.log("DIALOG count", await dlg.count());
console.log(await dlg.innerText().catch(() => "no dialog"));
console.log("INPUTS:", await page.$$eval("[role=dialog] input,[role=dialog] textarea,[role=dialog] select", (bs) => bs.map((b) => `${b.tagName}[${b.type}] req=${b.required} max=${b.maxLength} label=${b.labels?.[0]?.innerText?.trim()?.slice(0,40) || b.getAttribute("aria-label") || b.placeholder}`).join(" | ")));
console.log("FOCUSED:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200)));
// Envío vacío
const btns = await page.$$eval("[role=dialog] button", (bs) => bs.map((b) => `${b.innerText.trim() || b.getAttribute("aria-label")} disabled=${b.disabled}`));
console.log("DIALOG BTNS", btns);
console.log("AXE dialog", JSON.stringify(await axe(page)));
// Intentar crear vacío
const submit = page.locator("[role=dialog] button[type=submit]").first();
if (await submit.count()) {
  console.log("submit disabled?", await submit.isDisabled());
  if (!(await submit.isDisabled())) { await submit.click(); await page.waitForTimeout(500); await shot(page, "03-nueva-aula-vacia-error-1440"); console.log("after empty:", await dlg.innerText().catch(()=>"")); }
}
// Escape cierra?
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
console.log("dialog after Esc:", await page.getByRole("dialog").count());
console.log("LOG", JSON.stringify(log, null, 1));
await browser.close();

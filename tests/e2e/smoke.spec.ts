import { expect, test } from "@playwright/test";

// @smoke tests are safe to run against production: they create an anonymous workspace
// and delete it at the end.

test.describe("@smoke público", () => {
  test("la portada carga sin errores y explica el producto", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Un tutor que pregunta");
    await expect(page.getByRole("button", { name: "Empezar sin cuenta" })).toBeVisible();
    // No horizontal overflow at this viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  test("health responde ok", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).status).toBe("ok");
  });

  test("empezar sin cuenta abre el espacio y se puede borrar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Empezar sin cuenta" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).first()).toBeVisible();
    const del = await page.request.delete("/api/auth/workspace", {
      data: { confirm: "BORRAR" },
      headers: { "x-aula-client": "1", origin: new URL(page.url()).origin },
    });
    expect(del.ok()).toBeTruthy();
  });
});

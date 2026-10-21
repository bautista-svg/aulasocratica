import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Full teacher ↔ student journey. Needs AI: run against the local audit environment
// (scripts/dev/audit-env.sh → http://localhost:4300, AI replaced by a local simulator) or
// against an environment with a working Claude key.
//   E2E_BASE_URL=http://localhost:4300 npx playwright test tests/e2e/flows.spec.ts

async function api<T = any>(request: APIRequestContext, base: string, method: string, path: string, data?: unknown): Promise<T> {
  const r = await request.fetch(path, {
    method,
    data,
    headers: { "x-aula-client": "1", origin: base, "content-type": "application/json" },
  });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
  return (await r.json()) as T;
}

async function startWorkspace(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Empezar sin cuenta" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function studentJoins(page: Page, token: string, name: string) {
  await page.goto(`/clase/${token}`);
  await page.getByRole("textbox").first().fill(name);
  await page.getByRole("button", { name: "Entrar a la actividad" }).click();
}

test("docente publica, dos alumnos trabajan, el docente los ve por actividad, descarga el PDF y reinicia", async ({ page, browser, baseURL }) => {
  const base = new URL(baseURL!).origin;
  await startWorkspace(page);

  // Setup through the API with the teacher's own session (UI forms are covered by the UI audit).
  const { classroom } = await api(page.request, base, "POST", "/api/classrooms", { name: "E2E 5.º B" });
  const { activity } = await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "¿Por qué flotan los barcos?" });
  await api(page.request, base, "PATCH", `/api/activities/${activity.id}`, {
    instructions: "Explicá con tus palabras por qué un barco de acero puede flotar.",
    objectives: "Relacionar flotación con desplazamiento de agua.",
  });
  await api(page.request, base, "POST", `/api/activities/${activity.id}/publish`);
  const other = (await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "Otra actividad" })).activity;
  const detail = await api(page.request, base, "GET", `/api/activities/${activity.id}`);
  const token: string = detail.activity.linkToken;

  // Two students in their own browsers.
  for (const name of ["Ana Gómez", "Bruno Pérez"]) {
    const ctx = await browser.newContext();
    const s = await ctx.newPage();
    await studentJoins(s, token, name);
    await s.getByLabel("Tu primera idea").fill("Creo que flota porque el acero es liviano cuando es un barco.");
    await s.getByRole("button", { name: "Guardar y empezar a conversar" }).click();
    const composer = s.locator("#composer");
    await composer.fill("¿Por qué no se hunde si es pesado?");
    await composer.press("Enter");
    await expect(s.getByRole("list", { name: "Mensajes" })).toContainText("?", { timeout: 20_000 });
    if (name === "Ana Gómez") {
      await s.getByRole("button", { name: "Terminar" }).click();
      await s.getByLabel("Tu respuesta final").fill("Flota porque desplaza un volumen de agua que pesa lo mismo que el barco.");
      for (const box of await s.getByRole("group").getByRole("textbox").all()) await box.fill("Que importa el agua desplazada.");
      await s.getByRole("button", { name: "Enviar mi trabajo" }).click();
      await expect(s.getByText("Ahora pensás")).toBeVisible();
    }
    await ctx.close();
  }

  // Live view: only this activity's students.
  await page.goto(`/app/actividades/${activity.id}?tab=en-vivo`);
  await expect(page.getByText("Ana Gómez").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Bruno Pérez").filter({ visible: true }).first()).toBeVisible();
  await page.goto(`/app/actividades/${other.id}?tab=en-vivo`);
  await expect(page.getByText("Ana Gómez")).toHaveCount(0);

  // Ana's work → journey PDF.
  const live = await api(page.request, base, "GET", `/api/live/${activity.id}`);
  const ana = live.participants.find((p: { studentName: string }) => p.studentName === "Ana Gómez");
  await page.goto(`/app/sesiones/${ana.sessionId}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("Descargar PDF del recorrido").first().click()]);
  expect(download.suggestedFilename()).toMatch(/^Recorrido - Ana Gómez - .+\.pdf$/);

  // Reset the activity from the UI.
  await page.goto(`/app/actividades/${activity.id}?tab=configuracion`);
  await page.getByRole("button", { name: "Más acciones de la actividad" }).click();
  await page.getByRole("menuitem", { name: "Reiniciar actividad" }).click();
  await page.getByRole("alertdialog").getByRole("textbox").fill("REINICIAR");
  await page.getByRole("alertdialog").getByRole("button", { name: "Reiniciar actividad" }).click();
  await expect.poll(async () => (await api(page.request, base, "GET", `/api/live/${activity.id}`)).participants.length).toBe(0);

  // Cleanup.
  await api(page.request, base, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
});

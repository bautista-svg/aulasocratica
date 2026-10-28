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
  // The one-time "Nuevos cambios en la aplicación" notice.
  await page.getByRole("dialog", { name: "Nuevos cambios en la aplicación" }).getByRole("button", { name: "Entendido" }).click();
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

test("alertas en su propia pestaña: En vivo y el aula llevan a Alertas, y se marcan como revisadas", async ({ page, browser, baseURL }) => {
  const base = new URL(baseURL!).origin;
  await startWorkspace(page);
  const { classroom } = await api(page.request, base, "POST", "/api/classrooms", { name: "E2E Alertas" });
  const { activity } = await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "Ciclo del agua" });
  await api(page.request, base, "PATCH", `/api/activities/${activity.id}`, { instructions: "Contá cómo llega el agua de lluvia al mar." });
  await api(page.request, base, "POST", `/api/activities/${activity.id}/publish`);
  const token: string = (await api(page.request, base, "GET", `/api/activities/${activity.id}`)).activity.linkToken;

  // No alerts yet: the tab explains what will show up there.
  await page.goto(`/app/actividades/${activity.id}?tab=alertas`);
  await expect(page.getByRole("heading", { name: "No hay alertas" })).toBeVisible();

  // A student pastes text copied from somewhere else (the browser reports it as a signal).
  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await studentJoins(s, token, "Carla Ruiz");
  await s.getByLabel("Tu primera idea").fill("El agua se evapora y vuelve a caer.");
  await s.getByRole("button", { name: "Guardar y empezar a conversar" }).click();
  await expect(s.locator("#composer")).toBeVisible();
  await api(s.request, base, "POST", `/api/s/${token}/signal`, { kind: "pasted_text", chars: 900, fromMaterial: false });
  await ctx.close();

  // En vivo only points to the Alertas tab, which shows the count and the alert.
  await page.goto(`/app/actividades/${activity.id}?tab=en-vivo`);
  await expect(page.getByText("Carla Ruiz").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Revisada" })).toHaveCount(0);
  await page.getByRole("link", { name: /1 alerta abierta/ }).click();
  await expect(page).toHaveURL(/tab=alertas/);
  await expect(page.getByRole("tab", { name: /Alertas\s*1 abierta/ })).toBeVisible();
  const openList = page.getByRole("list", { name: "Alertas abiertas" });
  await expect(openList.getByText("Carla Ruiz")).toBeVisible();
  await openList.getByRole("button", { name: "Revisada" }).click();
  await expect(page.getByText("No quedan alertas por revisar.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Alertas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Ver las revisadas o descartadas \(1\)/ }).click();
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeVisible();

  // Reopened, the classroom list badge leads to the same tab.
  await page.getByRole("button", { name: "Reabrir" }).click();
  await page.goto(`/app/aulas/${classroom.id}`);
  await page.getByRole("link", { name: "1 alerta abierta en Ciclo del agua" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/actividades/${activity.id}\\?tab=alertas`));
  await expect(page.getByRole("list", { name: "Alertas abiertas" }).getByText("Carla Ruiz")).toBeVisible();

  await api(page.request, base, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
});

test("entrega obligatoria: el alumno sube su archivo, envía, y el docente lo ve en Evaluación y en Alertas", async ({ page, browser, baseURL }) => {
  const base = new URL(baseURL!).origin;
  await startWorkspace(page);
  const { classroom } = await api(page.request, base, "POST", "/api/classrooms", { name: "E2E 4.º A" });
  const { activity } = await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "Informe del experimento" });
  await api(page.request, base, "PATCH", `/api/activities/${activity.id}`, {
    instructions: "Contá qué pasó con el barco de aluminio.",
    requireInitialAnswer: false,
    deliverableMode: "required",
    deliverablePrompt: "Subí tu informe en PDF, Word, texto o una foto.",
  });
  await api(page.request, base, "POST", `/api/activities/${activity.id}/publish`);
  const token: string = (await api(page.request, base, "GET", `/api/activities/${activity.id}`)).activity.linkToken;

  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await studentJoins(s, token, "Carla Díaz");
  await s.getByRole("button", { name: "Terminar" }).click();
  await expect(s.getByText("Subí tu informe en PDF, Word, texto o una foto.")).toBeVisible();
  await s.getByLabel("Tu respuesta final").fill("El barco flota por su forma: desplaza mucha agua.");
  // Every reflection question is required.
  await expect(s.getByText("Te falta responder 2 preguntas de tu reflexión para poder enviar tu trabajo.")).toBeVisible();
  for (const box of await s.getByRole("group").getByRole("textbox").all()) await box.fill("Que la forma importa más que el material.");
  // Required file: sending is blocked until it is uploaded.
  await expect(s.getByRole("button", { name: "Enviar mi trabajo" })).toBeDisabled();
  await s.locator('input[type="file"]').setInputFiles({ name: "informe.txt", mimeType: "text/plain", buffer: Buffer.from("El barco de aluminio flotó con 20 monedas; la bola se hundió.") });
  await expect(s.getByRole("link", { name: "informe.txt" })).toBeVisible();
  await s.getByRole("button", { name: "Enviar mi trabajo" }).click();
  await expect(s.getByRole("heading", { name: "¡Terminaste la actividad!" })).toBeVisible();
  await expect(s.getByText("informe.txt")).toBeVisible();
  await ctx.close();

  const live = await api(page.request, base, "GET", `/api/live/${activity.id}`);
  await page.goto(`/app/sesiones/${live.participants[0].sessionId}?tab=evaluacion`);
  await expect(page.getByRole("heading", { name: "Entrega del alumno" })).toBeVisible();
  await expect(page.getByText("informe.txt")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", /\/deliverable\/file$/);

  await page.goto("/app/alertas");
  await expect(page.getByRole("heading", { name: "Alertas", level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: "Estado de las alertas" })).toBeVisible();

  await api(page.request, base, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
});

test("entrega con enlace: el alumno pega el enlace de su trabajo y el docente lo abre", async ({ page, browser, baseURL }) => {
  const base = new URL(baseURL!).origin;
  await startWorkspace(page);
  const { classroom } = await api(page.request, base, "POST", "/api/classrooms", { name: "E2E 6.º C" });
  const { activity } = await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "Mi presentación" });
  await api(page.request, base, "PATCH", `/api/activities/${activity.id}`, {
    instructions: "Contá qué aprendiste sobre Esparta.",
    requireInitialAnswer: false,
    deliverableMode: "required",
  });
  await api(page.request, base, "POST", `/api/activities/${activity.id}/publish`);
  const token: string = (await api(page.request, base, "GET", `/api/activities/${activity.id}`)).activity.linkToken;

  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await studentJoins(s, token, "Tomás Ruiz");
  await s.getByRole("button", { name: "Terminar" }).click();
  await s.getByLabel("Tu respuesta final").fill("Esparta era un estado militar y los ilotas trabajaban la tierra.");
  for (const box of await s.getByRole("group").getByRole("textbox").all()) await box.fill("Que hay que comparar con datos del texto.");
  await s.getByRole("button", { name: "Pegar un enlace" }).click();
  await s.getByLabel(/Enlace a tu trabajo/).fill("www.canva.com/design/DAF123/view");
  await s.getByRole("button", { name: "Guardar enlace" }).click();
  await expect(s.getByRole("link", { name: "Diseño de Canva" })).toHaveAttribute("href", "https://www.canva.com/design/DAF123/view");
  await s.getByRole("button", { name: "Enviar mi trabajo" }).click();
  await expect(s.getByRole("heading", { name: "¡Terminaste la actividad!" })).toBeVisible();
  await ctx.close();

  const live = await api(page.request, base, "GET", `/api/live/${activity.id}`);
  await page.goto(`/app/sesiones/${live.participants[0].sessionId}?tab=evaluacion`);
  await expect(page.getByText("Diseño de Canva")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir enlace" })).toHaveAttribute("href", "https://www.canva.com/design/DAF123/view");
  await expect(page.getByRole("button", { name: "Analizar con la rúbrica" })).toBeDisabled();

  await api(page.request, base, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
});

test("divisiones: el alumno elige la suya al entrar y la docente filtra En vivo por división", async ({ page, browser, baseURL }) => {
  const base = new URL(baseURL!).origin;
  await startWorkspace(page);
  const { classroom } = await api(page.request, base, "POST", "/api/classrooms", { name: "E2E 1.º año", divisionOptions: ["N", "F", "S"] });
  const { activity } = await api(page.request, base, "POST", "/api/activities", { classroomId: classroom.id, title: "Divisiones" });
  await api(page.request, base, "PATCH", `/api/activities/${activity.id}`, { instructions: "Contá qué aprendiste hoy.", requireInitialAnswer: false });
  await api(page.request, base, "POST", `/api/activities/${activity.id}/publish`);
  const token: string = (await api(page.request, base, "GET", `/api/activities/${activity.id}`)).activity.linkToken;

  for (const [name, division] of [
    ["Ana Gómez", "F"],
    ["Bruno Pérez", "N"],
  ] as const) {
    const ctx = await browser.newContext();
    const s = await ctx.newPage();
    await s.goto(`/clase/${token}`);
    await s.getByRole("textbox").first().fill(name);
    // Without a division it does not go in.
    await s.getByRole("button", { name: "Entrar a la actividad" }).click();
    await expect(s.getByText("Elegí tu división.")).toBeVisible();
    await s.getByRole("radiogroup", { name: "¿En qué división estás?" }).getByRole("radio", { name: division }).check({ force: true });
    await s.getByRole("button", { name: "Entrar a la actividad" }).click();
    await expect(s.getByText("Elegí tu división.")).toHaveCount(0);
    await expect(s.getByRole("button", { name: "Entrar a la actividad" })).toHaveCount(0);
    await ctx.close();
  }

  await page.goto(`/app/actividades/${activity.id}?tab=en-vivo`);
  const filter = page.getByRole("group", { name: "División" });
  await expect(filter.getByRole("button", { name: /Todas/ })).toHaveAttribute("aria-pressed", "true");
  await filter.getByRole("button", { name: /^F/ }).click();
  const participants = page.getByRole("region", { name: "Quién hizo esta actividad" });
  await expect(participants.getByText("Ana Gómez").filter({ visible: true }).first()).toBeVisible();
  await expect(participants.getByText("Bruno Pérez").filter({ visible: true })).toHaveCount(0);

  await api(page.request, base, "DELETE", "/api/auth/workspace", { confirm: "BORRAR" });
});

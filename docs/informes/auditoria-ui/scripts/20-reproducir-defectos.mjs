// Reproduce automáticamente los defectos principales en un espacio nuevo y descartable.
// Uso: node 20-reproducir-defectos.mjs   (requiere la app en http://localhost:4300)
import { launch, context, BASE, shot } from "./lib.mjs";

const out = {};
const browser = await launch();
const doc = await context(browser, { width: 1440, height: 900 });
const p = await doc.newPage();

// Espacio nuevo
await p.goto(BASE + "/", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Empezar sin cuenta" }).click();
await p.waitForURL(/\/app/);

// D01 — doble clic en "Crear aula" crea dos aulas
await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nueva aula" }).first().click();
await p.getByRole("dialog").getByLabel("Nombre del aula").fill("Repro doble clic");
await p.getByRole("dialog").getByRole("button", { name: "Crear aula" }).dblclick();
await p.waitForTimeout(2000);
await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
out.D01_aulas_creadas_con_doble_clic = ((await p.locator("main").innerText()).match(/Repro doble clic/g) || []).length;
await shot(p, "R-D01-aulas-duplicadas");

// Entrar al aula y crear una actividad con título largo (para D03) y doble clic (D01)
await p.locator("main a").filter({ hasText: "Repro doble clic" }).first().click();
await p.waitForTimeout(1000);
const aulaUrl = p.url();
await p.getByRole("button", { name: "Nueva actividad" }).first().click();
await p.getByRole("dialog").getByLabel("Título").fill("Fracciones equivalentes: comparación y ordenamiento en la recta numérica");
await p.getByRole("dialog").getByRole("button", { name: "Crear y seguir" }).dblclick();
await p.waitForTimeout(2500);
await p.goto(aulaUrl, { waitUntil: "networkidle" });
out.D01_actividades_creadas_con_doble_clic = (await p.$$eval("main a[href*='/app/actividades/']", (as) => as.length));

// D02 — el nombre del docente se muestra a los alumnos aunque la UI dice que no
await p.goto(BASE + "/app/cuenta", { waitUntil: "networkidle" });
out.D02_texto_en_mi_espacio = (await p.locator("main").innerText()).match(/[^\n]*alumnos no lo ven[^\n]*/)?.[0];
await p.getByLabel("Tu nombre o el de tu espacio").fill("Profe Repro");
await p.getByRole("button", { name: "Guardar" }).first().click();
await p.waitForTimeout(800);
await p.goto(aulaUrl, { waitUntil: "networkidle" });
await p.locator("main a[href*='/app/actividades/']").first().click();
await p.waitForTimeout(1200);
await p.getByRole("textbox", { name: "Consigna" }).fill("Consigna de reproducción.");
await p.getByRole("button", { name: "Publicar" }).first().click();
await p.waitForTimeout(1500);
const link = await p.locator("input[value*='/clase/']").first().inputValue();
const al = await context(browser, { width: 375, height: 812, mobile: true });
const s = await al.newPage();
await s.goto(link, { waitUntil: "networkidle" });
out.D02_alumno_ve = (await s.locator("body").innerText()).match(/Con Profe Repro/)?.[0] || null;
await shot(s, "R-D02-alumno-ve-nombre-docente");

// D06 — el borrador "se guarda en este dispositivo" pero se pierde en otra pestaña
await s.getByLabel("¿Cómo te llamás?").fill("Alumna Repro");
await s.getByRole("button", { name: "Entrar a la actividad" }).click();
await s.waitForTimeout(1500);
await s.getByLabel("Tu primera idea").fill("Borrador que debería quedar guardado");
await s.waitForTimeout(1000);
const s2 = await al.newPage();
await s2.goto(link, { waitUntil: "networkidle" });
await s2.waitForTimeout(800);
out.D06_borrador_en_nueva_pestana = await s2.getByLabel("Tu primera idea").inputValue();

// D12 — un código de 5 caracteres se envía y consume un intento
const al2 = await context(browser, { width: 430, height: 932, mobile: true });
const s3 = await al2.newPage();
await s3.goto(link, { waitUntil: "networkidle" });
await s3.getByRole("button", { name: /Usá tu código/ }).click();
await s3.getByLabel("Tu nombre").fill("Alumna Repro");
await s3.getByLabel("Tu código").fill("ABC12");
out.D12_boton_habilitado_con_5_caracteres = !(await s3.getByRole("button", { name: "Seguir mi trabajo" }).isDisabled());
await s3.getByRole("button", { name: "Seguir mi trabajo" }).click();
await s3.waitForTimeout(1200);
out.D12_mensaje = (await s3.locator("body").innerText()).match(/[^\n]*intentos[^\n]*/)?.[0];

// D04 — "Pensamiento crítico (predeterminado)" no usa la versión editada
await p.goto(BASE + "/app/tutores", { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Abrir Pensamiento crítico" }).click();
await p.getByRole("dialog").getByLabel(/Reglas del docente/).fill("REGLA-REPRO");
await p.getByRole("dialog").getByRole("button", { name: "Guardar cambios" }).click();
await p.waitForTimeout(1000);
await p.goto(aulaUrl, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nueva actividad" }).first().click();
out.D04_opciones = await p.$$eval("[role=dialog] select option", (os) => os.map((o) => o.textContent).filter((t) => /Pensamiento crítico/.test(t)));
await p.getByRole("dialog").getByLabel("Título").fill("Repro tutor predeterminado");
await p.getByRole("dialog").getByRole("button", { name: "Crear y seguir" }).click();
await p.waitForTimeout(2000);
out.D04_indicaciones_con_predeterminado = await p.locator("section#tutor textarea").first().inputValue();

// D05 — el foco no vuelve al botón al cerrar un diálogo
await p.goto(BASE + "/app/aulas", { waitUntil: "networkidle" });
const trig = p.getByRole("button", { name: "Nueva aula" }).first();
await trig.focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(500);
await p.keyboard.press("Escape"); await p.waitForTimeout(1000);
out.D05_foco_tras_cerrar = await p.evaluate(() => document.activeElement.tagName);

// D03 — Inicio en 375 px con un título largo desborda
const m = await context(browser, { width: 375, height: 812, mobile: true, storageState: await doc.storageState() });
const mp = await m.newPage();
await mp.goto(BASE + "/app", { waitUntil: "networkidle" });
await mp.waitForTimeout(800);
out.D03_inicio_375 = await mp.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
await shot(mp, "R-D03-inicio-375");

console.log(JSON.stringify(out, null, 2));
await browser.close();

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiMock } from "./ai-mock";
import { call, newClassroom, newTeacher } from "./helpers";
import { insertActivity } from "./live-fixtures";
import { db, schema } from "@server/db/client";
import { DEMO_CHECKS, demoMessages, seedWebDesignDemo } from "@server/services/code-defense-demo";

const CSS = ".grilla {\n  display: grid;\n  gap: 1rem;\n}\n.menu { display: flex; }\n";
const JS = "const b = document.querySelector('button');\nb.addEventListener('click', abrir);\n";
const FILES = [{ name: "estilos.css", text: CSS }, { name: "app.js", text: JS }];

const turn = (over: Record<string, unknown> = {}) => ({
  assessment: null,
  action: "ask",
  file: "estilos.css",
  fromLine: 1,
  toLine: 4,
  kind: "behavior",
  change: null,
  lead: "",
  question: "¿Qué hace esta regla?",
  ...over,
});
const assessed = (verdict = "explained") => ({ verdict, reason: "Lo dijo con sus palabras.", quote: "acomoda" });

async function setup(over: Record<string, unknown> = {}) {
  const t = await newTeacher();
  const roomId = await newClassroom(t.cookie);
  const activity = await insertActivity(t.id, roomId, { tutorType: "defensa_autoria", requireInitialAnswer: false, subject: "Diseño web", ...over });
  const join = await call("POST", `/api/s/${activity.linkToken}/join`, { body: { name: "Martina López" } });
  return { t, roomId, activity, token: activity.linkToken, cookie: join.cookies[0]!.split(";")[0]!, join };
}

async function chat(token: string, cookie: string, body: Record<string, unknown>) {
  const res = await call("POST", `/api/s/${token}/chat`, { cookie, body });
  const raw = typeof res.body === "string" ? res.body : "";
  const done = raw.split("\n\n").find((b) => b.startsWith("event: done"));
  const error = raw.split("\n\n").find((b) => b.startsWith("event: error"));
  return { status: res.status, raw, done: done ? JSON.parse(done.split("data: ")[1]!) : null, error: error ? JSON.parse(error.split("data: ")[1]!) : null, body: res.body };
}

// The turns of the defense, apart from the background alert detection that runs after each message.
const script: unknown[] = [];
beforeEach(() => {
  aiMock.reset();
  script.length = 0;
  aiMock.setFallback((body) =>
    JSON.stringify(body.system).includes("DEFENSA DE CÓDIGO") ? { kind: "json", value: script.shift() ?? turn() } : { kind: "json", value: { detections: [] } },
  );
});

describe("Defensa de código", () => {
  it("pide el código si nadie lo cargó, y no deja empezar sin él", async () => {
    const s = await setup();
    expect(s.join.body.workspace.codeDefense).toEqual({ needsCode: true });
    const early = await chat(s.token, s.cookie, { start: true });
    expect(early.status).toBe(409);
    const saved = await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    expect(saved.status).toBe(200);
    expect(saved.body.workspace.codeDefense).toEqual({ needsCode: false });
  });

  it("muestra el fragmento real, textual, aunque el alumno no tenga el código", async () => {
    const s = await setup();
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn());
    const first = await chat(s.token, s.cookie, { start: true });
    expect(first.done.text).toBe("```css estilos.css:1\n.grilla {\n  display: grid;\n  gap: 1rem;\n}\n```\n\n¿Qué hace esta regla?");
    const system = JSON.stringify(aiMock.lastRequest()!.body.system);
    expect(system).toContain("EL ESTUDIANTE NO TIENE EL CÓDIGO A MANO");
    expect(system).toContain("2|   display: grid;");
  });

  it("si la IA nombra líneas que no existen, vuelve a pedir y nunca inventa código", async () => {
    const s = await setup();
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn({ file: "otro.js", fromLine: 90, toLine: 95 }));
    script.push(turn({ file: "app.js", fromLine: 2, toLine: 2 }));
    const ok = await chat(s.token, s.cookie, { start: true });
    expect(ok.done.text).toContain("app.js:2");

    const other = await setup();
    await call("POST", `/api/s/${other.token}/code`, { cookie: other.cookie, body: { files: FILES } });
    script.push(turn({ file: "otro.js" }));
    script.push(turn({ file: "otro.js" }));
    const failed = await chat(other.token, other.cookie, { start: true });
    expect(failed.error.message).toMatch(/no pudo elegir/);
    expect(await db.select().from(schema.messages)).toHaveLength(1);
  });

  it("guarda cada respuesta con su evaluación, repregunta una vez y muestra el cambio", async () => {
    const s = await setup();
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn());
    await chat(s.token, s.cookie, { start: true });

    script.push(turn({ assessment: assessed("not_explained"), action: "reask", question: "Contame con otras palabras." }));
    const second = await chat(s.token, s.cookie, { text: "no sé" });
    expect(second.done.text).toContain("Contame con otras palabras.");

    script.push(turn({ assessment: assessed("partial"), file: "estilos.css", fromLine: 5, toLine: 5, kind: "change", change: { before: "display: flex", after: "display: block" }, question: "¿Qué pasaría?" }));
    const third = await chat(s.token, s.cookie, { text: "acomoda las cosas" });
    expect(third.done.text).toContain("```diff estilos.css\n- display: flex\n+ display: block\n```");

    const panel = await call("GET", `/api/code-defense/${s.activity.id}`, { cookie: s.t.cookie });
    expect(panel.body.students[0]).toMatchObject({ name: "Martina López", status: "working", answered: 1, partial: 1, band: "pending" });
    expect(panel.body.students[0].checks).toHaveLength(2);
    expect(panel.body.students[0].checks[0]).toMatchObject({ attempts: 2, verdict: "partial", answer: "no sé\n\nacomoda las cosas" });
    expect(panel.body.students[0].checks[1]).toMatchObject({ kind: "change", change: { before: "display: flex", after: "display: block" }, verdict: null });
  });

  it("termina sola y después no toma más mensajes", async () => {
    const s = await setup();
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn());
    await chat(s.token, s.cookie, { start: true });
    script.push(turn({ assessment: assessed(), file: "app.js", fromLine: 1, toLine: 2 }));
    await chat(s.token, s.cookie, { text: "acomoda la grilla" });
    script.push(turn({ assessment: assessed(), action: "finish", lead: "Gracias, tocá «Terminar».", question: "" }));
    const end = await chat(s.token, s.cookie, { text: "abre el menú" });
    expect(end.done).toMatchObject({ text: "Gracias, tocá «Terminar».", tutorDone: "achieved" });
    expect((await chat(s.token, s.cookie, { text: "hola" })).status).toBe(409);
    expect((await call("GET", `/api/s/${s.token}`, { cookie: s.cookie })).body.workspace.tutorDone).toBe("achieved");
  });

  it("no deja cambiar el código una vez que empezó a responder", async () => {
    const s = await setup();
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn());
    await chat(s.token, s.cookie, { start: true });
    expect((await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } })).status).toBe(409);
    expect((await chat(s.token, s.cookie, { start: true })).status).toBe(409);
  });

  it("la docente carga el código por nombre y el alumno entra sin subir nada; otra docente no lo ve", async () => {
    const t = await newTeacher();
    const roomId = await newClassroom(t.cookie);
    const activity = await insertActivity(t.id, roomId, { tutorType: "defensa_autoria", requireInitialAnswer: false });
    const put = await call("PUT", `/api/code-defense/${activity.id}/code`, { cookie: t.cookie, body: { studentName: "Tomás Ruiz", files: FILES } });
    expect(put.status).toBe(200);
    const join = await call("POST", `/api/s/${activity.linkToken}/join`, { body: { name: "tomas ruiz" } });
    expect(join.body.workspace.codeDefense).toEqual({ needsCode: false });
    const code = await call("GET", `/api/code-defense/${activity.id}/students/${put.body.studentId}/code`, { cookie: t.cookie });
    expect(code.body.files[0].text).toBe(CSS);
    const other = await newTeacher();
    expect((await call("GET", `/api/code-defense/${activity.id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("PUT", `/api/code-defense/${activity.id}/code`, { cookie: other.cookie, body: { studentName: "Tomás", files: FILES } })).status).toBe(404);
  });

  it("con el código en Material, todo el curso defiende ese y nadie sube nada", async () => {
    const s = await setup({ material: ".a { color: red; }" });
    expect(s.join.body.workspace.codeDefense).toEqual({ needsCode: false });
  });

  it("no pide respuesta inicial aunque la actividad la tenga prendida", async () => {
    const s = await setup({ requireInitialAnswer: true });
    expect(s.join.body.workspace.stage).toBe("tutor");
    await call("POST", `/api/s/${s.token}/code`, { cookie: s.cookie, body: { files: FILES } });
    script.push(turn());
    expect((await chat(s.token, s.cookie, { start: true })).done.text).toContain("estilos.css:1");
  });

  it("una actividad común no cambia", async () => {
    const t = await newTeacher();
    const roomId = await newClassroom(t.cookie);
    const activity = await insertActivity(t.id, roomId, { requireInitialAnswer: false });
    const join = await call("POST", `/api/s/${activity.linkToken}/join`, { body: { name: "Ana Paz" } });
    expect(join.body.workspace.codeDefense).toBeNull();
  });
});

describe("Ejemplo de Diseño web", () => {
  it("todos los fragmentos salen del código de ejemplo", () => {
    for (const c of DEMO_CHECKS) expect(demoMessages(c).fragment.code.length).toBeGreaterThan(0);
  });

  it("crea el aula y la actividad con resultados y avisa en Pedidos, una sola vez", async () => {
    const t = await newTeacher();
    await db.update(schema.teachers).set({ email: "profe@escuela.edu.ar", canRequestChanges: true }).where(eq(schema.teachers.id, t.id));
    const first = await seedWebDesignDemo("Profe@Escuela.edu.ar");
    expect(first.created).toBe(true);
    const again = await seedWebDesignDemo("profe@escuela.edu.ar");
    expect(again).toMatchObject({ created: false, activityId: first.activityId });

    const panel = await call("GET", `/api/code-defense/${first.activityId}`, { cookie: t.cookie });
    const band = Object.fromEntries(panel.body.students.map((s: { name: string; band: string }) => [s.name, s.band]));
    expect(band).toEqual({ "Joaquín Demo": "pending", "Lucía Demo": "struggles", "Martina Demo": "explains", "Sofía Demo": "pending", "Tomás Demo": "partly" });

    const activity = await call("GET", `/api/activities/${first.activityId}`, { cookie: t.cookie });
    expect(activity.body.activity).toMatchObject({ title: "Prueba", subject: "Diseño web", tutorType: "defensa_autoria", status: "published" });
    const requests = await call("GET", "/api/requests", { cookie: t.cookie });
    expect(requests.body.requests.filter((r: { status: string; note: string }) => r.status === "done" && r.note.includes("Diseño web"))).toHaveLength(1);
  });
});

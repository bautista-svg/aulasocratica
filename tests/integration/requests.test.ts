import { describe, expect, it } from "vitest";
import { call, cookiePair, newClassroom, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";
import { GREETING } from "@server/services/requests";

const PASSWORD = "test-admin-password-123456"; // vitest.config.ts
// 1×1 transparent PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

async function admin(): Promise<string> {
  const r = await call("POST", "/api/admin/login", { body: { password: PASSWORD } });
  expect(r.status).toBe(200);
  return cookiePair(r.cookies, "as_admin");
}

/** A teacher with an account (email) and, if asked, the section enabled by the admin. */
async function teacher(email: string, enabled = true) {
  const t = await newTeacher();
  const reg = await call("POST", "/api/auth/register", { cookie: t.cookie, body: { email, password: "una-clave-larga" } });
  expect(reg.status).toBe(200);
  if (enabled) {
    const on = await call("POST", "/api/admin/requests-access", { cookie: await admin(), body: { email: email.toUpperCase(), enabled: true } });
    expect(on.status).toBe(200);
  }
  return t;
}

function message(text: string, ...images: File[]) {
  const f = new FormData();
  f.set("text", text);
  for (const img of images) f.append("file", img);
  return f;
}

const png = (name = "captura.png") => new File([PNG], name, { type: "image/png" });

const UNDERSTOOD = {
  reply: "¿En qué actividad te pasa? ¿Me pasás una captura?",
  ready: false,
  summary: {
    kind: "Change ",
    title: "Poder sacar la reflexión final",
    screen: "Actividad → Configuración → Reflexión final",
    today: "Siempre aparece la reflexión.",
    desired: "Poder apagarla.",
    details: ["Un interruptor", "  ", "Las preguntas quedan guardadas"],
  },
};

describe("change requests: access", () => {
  it("is hidden until the admin enables it for the account, and enabling it touches nothing else", async () => {
    const t = await teacher("vanina@escuela.edu.ar", false);
    const room = await newClassroom(t.cookie, "3.º A");
    expect((await call("GET", "/api/auth/me", { cookie: t.cookie })).body.teacher.canRequestChanges).toBe(false);
    expect((await call("GET", "/api/requests", { cookie: t.cookie })).status).toBe(403);
    expect((await call("POST", "/api/requests", { cookie: t.cookie })).status).toBe(403);

    // Only the admin can enable it.
    expect((await call("POST", "/api/admin/requests-access", { body: { email: "vanina@escuela.edu.ar" } })).status).toBe(401);
    const cookie = await admin();
    expect((await call("POST", "/api/admin/requests-access", { cookie, body: { email: "nadie@escuela.edu.ar" } })).status).toBe(404);
    const on = await call("POST", "/api/admin/requests-access", { cookie, body: { email: "Vanina@Escuela.edu.ar" } });
    expect(on.status).toBe(200);
    expect(on.body.teacher.enabled).toBe(true);

    expect((await call("GET", "/api/auth/me", { cookie: t.cookie })).body.teacher.canRequestChanges).toBe(true);
    expect((await call("GET", "/api/requests", { cookie: t.cookie })).body.requests).toEqual([]);
    const rooms = await call("GET", "/api/classrooms", { cookie: t.cookie });
    expect(rooms.body.classrooms.map((c: { id: string }) => c.id)).toContain(room);

    const off = await call("POST", "/api/admin/requests-access", { cookie, body: { email: "vanina@escuela.edu.ar", enabled: false } });
    expect(off.body.teacher.enabled).toBe(false);
    expect((await call("GET", "/api/requests", { cookie: t.cookie })).status).toBe(403);
  });
});

describe("change requests: the conversation", () => {
  it("saves her message with screenshots, then the AI asks and fills the summary; she sends it", async () => {
    const t = await teacher("vanina@escuela.edu.ar");
    const created = await call("POST", "/api/requests", { cookie: t.cookie });
    expect(created.status).toBe(201);
    const id = created.body.request.id as string;
    expect(created.body.request.status).toBe("draft");
    expect(created.body.request.messages).toEqual([expect.objectContaining({ role: "assistant", text: GREETING })]);
    // "Nuevo pedido" twice opens the same empty draft; an empty draft is not listed.
    expect((await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id).toBe(id);
    expect((await call("GET", "/api/requests", { cookie: t.cookie })).body.requests).toEqual([]);

    expect((await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("  ") })).status).toBe(400);
    const notImage = new File(["hola"], "notas.txt", { type: "text/plain" });
    expect((await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("mirá", notImage) })).status).toBe(400);
    expect(
      (await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("muchas", png(), png(), png(), png()) })).status,
    ).toBe(400);

    const sent = await call("POST", `/api/requests/${id}/messages`, {
      cookie: t.cookie,
      form: message("Quiero poder sacar la reflexión final", png()),
    });
    expect(sent.status).toBe(200);
    expect(sent.body.request.awaitingReply).toBe(true);
    expect(sent.body.request.images).toHaveLength(1);
    const img = sent.body.request.images[0];
    expect(sent.body.request.messages.at(-1)).toMatchObject({ role: "teacher", text: "Quiero poder sacar la reflexión final", imageIds: [img.id] });

    aiMock.json(UNDERSTOOD);
    const replied = await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie });
    expect(replied.status).toBe(200);
    const r = replied.body.request;
    expect(r.awaitingReply).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.title).toBe("Poder sacar la reflexión final");
    expect(r.summary).toMatchObject({ kind: "change", details: ["Un interruptor", "Las preguntas quedan guardadas"] });
    expect(r.messages.at(-1)).toMatchObject({ role: "assistant", text: UNDERSTOOD.reply });
    // The AI sees the app map, her words and her screenshot.
    const body = aiMock.lastRequest()!.body as { system: unknown; messages: { content: { type: string; text?: string }[] }[] };
    expect(JSON.stringify(body.system)).toContain("MAPA DE LA APP");
    const blocks = body.messages[0]!.content;
    expect(blocks.some((b) => b.type === "image")).toBe(true);
    expect(blocks.some((b) => b.text?.includes("DOCENTE: Quiero poder sacar la reflexión final"))).toBe(true);
    // Answering twice does not add a second reply.
    expect((await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie })).body.request.messages).toHaveLength(3);

    const shot = await call("GET", img.url, { cookie: t.cookie });
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");

    await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("En todas, con un interruptor.") });
    aiMock.json({ ...UNDERSTOOD, reply: "¡Listo! Revisá el resumen y envialo.", ready: true });
    expect((await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie })).body.request.ready).toBe(true);

    const submitted = await call("POST", `/api/requests/${id}/submit`, { cookie: t.cookie });
    expect(submitted.status).toBe(200);
    expect(submitted.body.request.status).toBe("pending");
    expect(submitted.body.request.submittedAt).toBeTruthy();
    const list = await call("GET", "/api/requests", { cookie: t.cookie });
    expect(list.body.requests.map((x: { id: string }) => x.id)).toEqual([id]);
    // A sent request is not deleted (she can cancel it instead).
    expect((await call("DELETE", `/api/requests/${id}`, { cookie: t.cookie })).status).toBe(409);
  });

  it("keeps her message when the AI fails, and answers it on retry", async () => {
    const t = await teacher("vanina@escuela.edu.ar");
    const id = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("No me deja entrar") });
    aiMock.error(500);
    aiMock.error(500);
    aiMock.error(500);
    const failed = await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const after = await call("GET", `/api/requests/${id}`, { cookie: t.cookie });
    expect(after.body.request.awaitingReply).toBe(true);
    expect(after.body.request.messages.at(-1).text).toBe("No me deja entrar");

    aiMock.reset();
    aiMock.json({ ...UNDERSTOOD, summary: { ...UNDERSTOOD.summary, kind: "fix" } });
    const ok = await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.request.summary.kind).toBe("fix");
  });

  it("another workspace cannot see, answer or open the screenshots of her request", async () => {
    const t = await teacher("vanina@escuela.edu.ar");
    const other = await teacher("otra@escuela.edu.ar");
    const id = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    const sent = await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("hola", png()) });
    const url = sent.body.request.images[0].url as string;
    expect((await call("GET", `/api/requests/${id}`, { cookie: other.cookie })).status).toBe(404);
    expect((await call("POST", `/api/requests/${id}/messages`, { cookie: other.cookie, form: message("x") })).status).toBe(404);
    expect((await call("GET", url, { cookie: other.cookie })).status).toBe(404);
    expect((await call("GET", url)).status).toBe(401);
  });
});

describe("change requests: the admin side", () => {
  it("lists sent requests with who sent them, serves the screenshots and answers with a status and a note", async () => {
    const t = await teacher("vanina@escuela.edu.ar");
    const draft = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    await call("POST", `/api/requests/${draft}/messages`, { cookie: t.cookie, form: message("todavía pensando") });
    const id = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    expect(id).not.toBe(draft);
    await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("Quiero sacar la reflexión", png()) });
    aiMock.json({ ...UNDERSTOOD, ready: true });
    await call("POST", `/api/requests/${id}/reply`, { cookie: t.cookie });
    await call("POST", `/api/requests/${id}/submit`, { cookie: t.cookie });

    expect((await call("GET", "/api/admin/requests")).status).toBe(401);
    const cookie = await admin();
    const list = await call("GET", "/api/admin/requests", { cookie });
    expect(list.status).toBe(200);
    // Drafts are hers until she sends them.
    expect(list.body.requests).toHaveLength(1);
    const r = list.body.requests[0];
    expect(r).toMatchObject({ id, status: "pending", teacher: { email: "vanina@escuela.edu.ar" }, summary: { title: "Poder sacar la reflexión final" } });
    expect(r.images[0].url).toBe(`/api/admin/requests/${id}/images/${r.images[0].id}`);
    expect((await call("GET", r.images[0].url, { cookie })).status).toBe(200);
    expect((await call("GET", `/api/admin/requests/${draft}`, { cookie })).status).toBe(404);

    const started = await call("PATCH", `/api/admin/requests/${id}`, { cookie, body: { status: "in_progress" } });
    expect(started.body.request.status).toBe("in_progress");
    expect((await call("POST", `/api/requests/${id}/withdraw`, { cookie: t.cookie })).status).toBe(409);

    const done = await call("PATCH", `/api/admin/requests/${id}`, {
      cookie,
      body: { status: "done", note: "Listo: en Configuración → Reflexión final hay un interruptor." },
    });
    expect(done.body.request).toMatchObject({ status: "done", note: expect.stringContaining("interruptor") });
    expect(done.body.request.resolvedAt).toBeTruthy();
    expect((await call("PATCH", `/api/admin/requests/${id}`, { cookie, body: { status: "draft" } })).status).toBe(400);

    const mine = await call("GET", `/api/requests/${id}`, { cookie: t.cookie });
    expect(mine.body.request).toMatchObject({ status: "done", note: expect.stringContaining("interruptor") });
    expect((await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("una cosa más") })).status).toBe(409);

    expect((await call("GET", "/api/admin/requests", { cookie })).body.requests).toHaveLength(0);
    expect((await call("GET", "/api/admin/requests?status=all", { cookie })).body.requests).toHaveLength(1);
  });

  it("she can cancel a sent request that has not started, and delete a draft with its screenshots", async () => {
    const t = await teacher("vanina@escuela.edu.ar");
    const id = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    await call("POST", `/api/requests/${id}/messages`, { cookie: t.cookie, form: message("algo") });
    await call("POST", `/api/requests/${id}/submit`, { cookie: t.cookie });
    const cancelled = await call("POST", `/api/requests/${id}/withdraw`, { cookie: t.cookie });
    expect(cancelled.body.request).toMatchObject({ status: "discarded", note: "Cancelado por la docente." });

    const draft = (await call("POST", "/api/requests", { cookie: t.cookie })).body.request.id;
    const sent = await call("POST", `/api/requests/${draft}/messages`, { cookie: t.cookie, form: message("", png()) });
    expect(sent.status).toBe(200);
    expect((await call("DELETE", `/api/requests/${draft}`, { cookie: t.cookie })).status).toBe(200);
    expect((await call("GET", `/api/requests/${draft}`, { cookie: t.cookie })).status).toBe(404);
  });
});

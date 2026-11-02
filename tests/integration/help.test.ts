import { describe, expect, it } from "vitest";
import { call, newTeacher } from "./helpers";
import { aiMock } from "./ai-mock";

describe("ayuda «¿Dónde está…?»", () => {
  it("responde dónde está y nombra un lugar de la app", async () => {
    const t = await newTeacher();
    aiMock.json({ answer: "Entrá a la actividad › 2 Compartir y copiá el enlace.", placeId: "compartir_enlace" });
    const r = await call("POST", "/api/help/ask", {
      cookie: t.cookie,
      body: { question: "¿Cómo les paso el enlace a mis alumnos?", path: "/app" },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ answer: "Entrá a la actividad › 2 Compartir y copiá el enlace.", placeId: "compartir_enlace" });

    const sent = aiMock.lastRequest()!.body as { system: unknown; messages: { content: unknown }[] };
    expect(JSON.stringify(sent.system)).toContain("compartir_enlace:");
    expect(JSON.stringify(sent.messages)).toContain("¿Cómo les paso el enlace a mis alumnos?");
  });

  it("descarta un lugar que no existe", async () => {
    const t = await newTeacher();
    aiMock.json({ answer: "Eso no está en la app.", placeId: "panel_secreto" });
    const r = await call("POST", "/api/help/ask", { cookie: t.cookie, body: { question: "¿Dónde exporto a Excel?" } });
    expect(r.status).toBe(200);
    expect(r.body.placeId).toBeNull();
  });

  it("valida la pregunta y pide un espacio abierto", async () => {
    const t = await newTeacher();
    const empty = await call("POST", "/api/help/ask", { cookie: t.cookie, body: { question: " " } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.question).toBeTruthy();

    const anonymous = await call("POST", "/api/help/ask", { body: { question: "¿Dónde están mis aulas?" } });
    expect(anonymous.status).toBe(401);
  });

  it("si la IA falla, llega un mensaje para mostrar", async () => {
    const t = await newTeacher();
    aiMock.error(529);
    const r = await call("POST", "/api/help/ask", { cookie: t.cookie, body: { question: "¿Dónde están mis aulas?" } });
    expect(r.status).toBe(503);
    expect(typeof r.body.error.message).toBe("string");
  });
});

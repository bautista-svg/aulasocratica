// The student's screens in the activity's language: Spanish keeps the server's messages as they
// are; English translates the known error codes and field messages and falls back to the server.
import { describe, expect, it } from "vitest";
import { ApiError } from "@client/lib/api";
import { validateDeliverable, validateDeliverableLink } from "@shared/domain/deliverables";
import { STUDENT_STRINGS } from "./i18n";

const { es, en } = STUDENT_STRINGS;

function shape(o: unknown): unknown {
  if (typeof o === "function") return "fn";
  if (o && typeof o === "object") return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape((o as Record<string, unknown>)[k])]));
  return typeof o;
}

describe("student strings", () => {
  it("both languages have the same keys", () => {
    expect(shape(en)).toEqual(shape(es));
  });

  it("Spanish shows the server's message unchanged", () => {
    const err = new ApiError(429, "Mandaste muchos mensajes seguidos. Tomate un momento para pensar y seguí en un minuto.", "rate_limited");
    expect(es.error(err)).toBe(err.message);
    expect(es.fieldError("finalAnswer", "Escribí tu respuesta final.")).toBe("Escribí tu respuesta final.");
    expect(es.availability("inactive", "Tu docente cerró esta actividad por ahora.")).toBe("Tu docente cerró esta actividad por ahora.");
    expect(es.error(new Error("boom"))).toBe("Ocurrió un error inesperado.");
  });
});

describe("English errors", () => {
  it("translates the known student codes", () => {
    expect(en.error(new ApiError(429, "Mandaste muchos mensajes seguidos. Tomate un momento…", "rate_limited"))).toMatch(/^You sent a lot of messages/);
    expect(en.error(new ApiError(409, "El tutor todavía está respondiendo tu mensaje anterior.", "busy"))).toMatch(/still answering/);
    expect(en.error(new ApiError(403, "Esta actividad ya terminó.", "unavailable", { availability: "expired" }))).toBe("This activity has ended.");
    expect(en.error(new ApiError(429, "Este espacio alcanzó el límite diario de uso de IA.", "ai_quota"))).toMatch(/usage limit/);
    expect(en.error(new ApiError(0, "No hay conexión con el servidor. Revisá tu internet y probá de nuevo.", "network"))).toMatch(/^Can't connect/);
    expect(en.streamError({ message: "La IA no pudo responder. Probá de nuevo en unos segundos.", code: "ai_failed" })).toMatch(/^The tutor couldn't answer/);
  });

  it("keeps the attempts left of a wrong code", () => {
    const msg = "Ese nombre y ese código no coinciden con ningún trabajo de esta actividad. Revisá los dos o pedile tu código a tu docente (te quedan 3 intentos).";
    expect(en.error(new ApiError(400, msg, "wrong_code"))).toMatch(/\(3 tries left\)\.$/);
  });

  it("falls back to the server's message for unknown codes", () => {
    expect(en.error(new ApiError(418, "Algo raro.", "teapot"))).toBe("Algo raro.");
    expect(en.error(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("");
  });

  it("translates field messages", () => {
    expect(en.fieldError("finalAnswers.1", "Escribí tu respuesta a esta consigna.")).toBe("Write your answer to this task.");
    expect(en.fieldError("code", "Faltan 3 letras o números: el código tiene 6.")).toBe("3 letters or numbers are missing: the code has 6.");
    expect(en.fieldError("text", "Tu mensaje puede tener hasta 3000 caracteres.")).toBe("Your message can be up to 3000 characters.");
    expect(en.fieldError("reflection.0.answer", "Cada respuesta puede tener hasta 2000 caracteres.")).toBe("Each answer can be up to 2000 characters.");
    expect(en.fieldError("name", "Escribí tu nombre con letras.")).toBe("Write your name using letters.");
  });

  it("explains rejected files and links in English", () => {
    const old = { name: "tarea.doc", type: "application/msword", size: 1000 };
    const big = { name: "foto.jpg", type: "image/jpeg", size: 8 * 1024 * 1024 };
    for (const f of [old, big]) {
      const check = validateDeliverable(f);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(es.deliv.fileProblem(f, check.error)).toBe(check.error);
        expect(en.deliv.fileProblem(f, check.error)).toMatch(new RegExp(`^"${f.name}"`));
      }
    }
    expect(en.deliv.fileProblem(big, "")).toMatch(/photos can be up to 5 MB/);
    const link = validateDeliverableLink("  ");
    expect(link.ok).toBe(false);
    if (!link.ok) expect(en.deliv.linkProblem("  ", link.error)).toBe("Paste the link to your work.");
    expect(en.deliv.linkName("Documento de Google")).toBe("Google Doc");
  });

  it("uses the English availability message", () => {
    expect(en.availability("not_started", "Esta actividad todavía no empezó.")).toBe("This activity hasn't started yet.");
  });
});

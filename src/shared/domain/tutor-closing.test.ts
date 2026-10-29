import { describe, expect, it } from "vitest";
import { DONE_MARKER, clampMaxQuestions, markerFilter, stripDoneMarker, tutorDoneReason } from "./tutor-closing";

describe("tutorDoneReason", () => {
  const base = { maxQuestions: null, stopWhenAchieved: false, asked: 0, achieved: false };
  it("never ends without a limit or the objective setting", () => {
    expect(tutorDoneReason({ ...base, asked: 99, achieved: true })).toBeNull();
  });
  it("ends when the tutor wrote as many messages as the limit", () => {
    expect(tutorDoneReason({ ...base, maxQuestions: 5, asked: 4 })).toBeNull();
    expect(tutorDoneReason({ ...base, maxQuestions: 5, asked: 5 })).toBe("limit");
  });
  it("ends early when the objective was achieved and the teacher asked for it", () => {
    expect(tutorDoneReason({ ...base, stopWhenAchieved: true, achieved: true, maxQuestions: 10, asked: 3 })).toBe("achieved");
  });
  it("clamps the limit", () => {
    expect(clampMaxQuestions(0)).toBe(2);
    expect(clampMaxQuestions(400)).toBe(40);
  });
});

describe("done marker", () => {
  it("is removed from the saved reply", () => {
    expect(stripDoneMarker(`¡Muy bien! Tocá «Terminar».\n${DONE_MARKER}`)).toEqual({ text: "¡Muy bien! Tocá «Terminar».", found: true });
    expect(stripDoneMarker("Listo [[ terminado ]]").found).toBe(true);
    expect(stripDoneMarker("¿Qué hace esta línea?")).toEqual({ text: "¿Qué hace esta línea?", found: false });
  });
  it("never reaches the student while streaming, even split across chunks", () => {
    const f = markerFilter();
    const chunks = ["Muy bien. Tocá «Terminar».\n[", "[TERMI", "NADO", "]]"];
    const out = chunks.map((c) => f.push(c)).join("") + f.end();
    expect(out).toBe("Muy bien. Tocá «Terminar».\n");
    expect(f.found).toBe(true);
  });
  it("lets a bracket that is not the marker through", () => {
    const f = markerFilter();
    const out = ["Mirá `a[", "0]` y decime"].map((c) => f.push(c)).join("") + f.end();
    expect(out).toBe("Mirá `a[0]` y decime");
    expect(f.found).toBe(false);
  });
});

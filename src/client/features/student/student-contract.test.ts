// Pure helpers of the student contract used by the entry screen (and re-checked on the server).
import { describe, expect, it } from "vitest";
import { normalizeResumeCode, resumeBody, resumeCodeProblem, studentMetaLine } from "@shared/contracts/student";

describe("resume code format", () => {
  it("accepts 6 characters of the code alphabet, ignoring case, spaces and dashes", () => {
    expect(resumeCodeProblem("K7M2QX")).toBeNull();
    expect(resumeCodeProblem("k7m-2qx")).toBeNull();
    expect(resumeCodeProblem(" k7m 2qx ")).toBeNull();
    expect(normalizeResumeCode("k7m-2qx")).toBe("K7M2QX");
  });

  it("explains what is wrong without sending it", () => {
    expect(resumeCodeProblem("")).toBe("Escribí tu código.");
    expect(resumeCodeProblem("B4GV7")).toBe("Falta 1 letra o número: el código tiene 6.");
    expect(resumeCodeProblem("B4G")).toMatch(/^Faltan 3 letras o números/);
    expect(resumeCodeProblem("B4GV7KK")).toMatch(/^Sobran/);
    // 0, O, 1 and I are never part of a code.
    expect(resumeCodeProblem("B4GV7O")).toMatch(/0, O, 1 ni I/);
    expect(resumeCodeProblem("B4GV71")).toMatch(/0, O, 1 ni I/);
  });

  it("the API body rejects malformed codes with the same message", () => {
    const bad = resumeBody.safeParse({ name: "Ana", code: "B4GV7" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/^Falta 1 /);
    expect(resumeBody.safeParse({ name: "Ana", code: "b4g-v7k" }).success).toBe(true);
  });
});

describe("studentMetaLine", () => {
  it("does not repeat the subject or the grade the classroom name already has", () => {
    const classroom = studentMetaLine(["5.º B — Ciencias Naturales", "5.º grado B", "Escuela N.º 12 Domingo F. Sarmiento"]);
    expect(classroom).toBe("5.º B — Ciencias Naturales · Escuela N.º 12 Domingo F. Sarmiento");
    expect(studentMetaLine(["Ciencias Naturales", classroom])).toBe(classroom);
  });

  it("keeps every part when nothing repeats", () => {
    expect(studentMetaLine(["Matemática", "6.º A · Escuela 3"])).toBe("Matemática · 6.º A · Escuela 3");
    expect(studentMetaLine(["Lengua", "", null, "4.º B"])).toBe("Lengua · 4.º B");
  });

  it("a short name contained in the grade gives way to the longer label", () => {
    expect(studentMetaLine(["A", "5.º A"])).toBe("5.º A");
  });
});

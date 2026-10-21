import { describe, expect, it } from "vitest";
import { MAX_NAME_CHARS, nameKey, parseNameList, tidyName, validateStudentName } from "./names";

describe("tidyName", () => {
  it("keeps the capitalization the student typed (only trims and collapses spaces)", () => {
    expect(tidyName("  María   de los Ángeles  McDonald ")).toBe("María de los Ángeles McDonald");
    expect(tidyName("maría de los ángeles MCDONALD")).toBe("maría de los ángeles MCDONALD");
    expect(tidyName("Juan Pablo DʼAngelo\tO'Brien")).toBe("Juan Pablo DʼAngelo O'Brien");
  });

  it("drops invisible characters that could disguise a name", () => {
    expect(tidyName("Ana​ Pérez‮")).toBe("Ana Pérez");
  });

  it("cuts long names by characters without splitting letters", () => {
    const long = "ñ".repeat(MAX_NAME_CHARS + 10);
    expect(Array.from(tidyName(long))).toHaveLength(MAX_NAME_CHARS);
  });
});

describe("nameKey", () => {
  it("matches regardless of case, accents and spaces", () => {
    expect(nameKey("María de los Ángeles McDonald")).toBe(nameKey("  maria DE LOS angeles   mcdonald"));
    expect(nameKey("Lucía Gómez")).toBe("lucia gomez");
  });
});

describe("validateStudentName", () => {
  it("returns the name as typed and its key", () => {
    expect(validateStudentName("  lucía   GÓMEZ ")).toEqual({ ok: true, name: "lucía GÓMEZ", key: "lucia gomez" });
  });

  it("rejects empty, letterless and too long names", () => {
    expect(validateStudentName("   ").ok).toBe(false);
    expect(validateStudentName("1234").ok).toBe(false);
    expect(validateStudentName("a".repeat(MAX_NAME_CHARS + 1))).toEqual({ ok: false, error: "El nombre es demasiado largo." });
  });
});

describe("parseNameList", () => {
  it("splits lines, drops numbering and duplicates, and keeps each name as written", () => {
    expect(parseNameList("1. Ana Pérez\n2) ana perez\nBeto  GÓMEZ\n\n")).toEqual(["Ana Pérez", "Beto GÓMEZ"]);
    expect(parseNameList("Ana; Beto, Caro")).toEqual(["Ana", "Beto", "Caro"]);
  });
});

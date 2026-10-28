import { describe, expect, it } from "vitest";
import { divisionCounts, divisionOptionsProblem, inDivision, matchDivision, sanitizeDivisionOptions } from "./divisions";

describe("divisions", () => {
  it("cleans the list: texts only, tidy, without repeats (ignoring case and accents), up to 12", () => {
    expect(sanitizeDivisionOptions(["  N ", "F", "n", "S", "", 3, null, "Sí", "si"])).toEqual(["N", "F", "S", "Sí"]);
    expect(sanitizeDivisionOptions("N")).toEqual([]);
    expect(sanitizeDivisionOptions(Array.from({ length: 20 }, (_, i) => `D${i}`))).toHaveLength(12);
    expect(sanitizeDivisionOptions(["Turno tarde con un nombre muy largo"])).toEqual(["Turno tarde con un n"]);
  });

  it("explains a list over the limits", () => {
    expect(divisionOptionsProblem(["N", "F", "S"])).toBeNull();
    expect(divisionOptionsProblem(["x".repeat(21)])).toMatch(/hasta 20 caracteres/);
    expect(divisionOptionsProblem(Array.from({ length: 13 }, (_, i) => `D${i}`))).toMatch(/hasta 12 divisiones/);
    // Repeats do not count twice.
    expect(divisionOptionsProblem([...Array.from({ length: 12 }, (_, i) => `D${i}`), "d0"])).toBeNull();
  });

  it("matches what a student picked to the option as the teacher wrote it", () => {
    expect(matchDivision(["N", "F", "S"], " n ")).toBe("N");
    expect(matchDivision(["Mañana"], "manana")).toBe("Mañana");
    expect(matchDivision(["N", "F", "S"], "X")).toBeNull();
    expect(matchDivision(["N"], "")).toBeNull();
  });

  it("counts the filter's choices: the classroom's, then others present, then «Sin división»", () => {
    expect(divisionCounts(["N", "F", "S"], ["N", "n", "S", "", "B"])).toEqual([
      { value: "N", count: 2 },
      { value: "F", count: 0 },
      { value: "S", count: 1 },
      { value: "B", count: 1 },
      { value: "", count: 1 },
    ]);
    expect(divisionCounts([], ["", ""])).toEqual([]);
    expect(divisionCounts([], ["A", ""])).toEqual([
      { value: "A", count: 1 },
      { value: "", count: 1 },
    ]);
  });

  it("filters by division ('' = without one)", () => {
    expect(inDivision("n", "N")).toBe(true);
    expect(inDivision("", "")).toBe(true);
    expect(inDivision("F", "")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { PRESET_KEYS, TUTOR_PRESETS, matchesPreset, presetValues, tutorGroup } from "./tutor-presets";
import { TUTOR_TYPES, TUTOR_TYPE_INFO, TUTOR_TYPE_GUIDANCE } from "./pedagogy";
import { tutorBody } from "../contracts/tutors";

describe("tutor presets", () => {
  it("has one valid preset per tutor type (18)", () => {
    expect(PRESET_KEYS).toHaveLength(19);
    expect([...PRESET_KEYS].sort()).toEqual(Object.keys(TUTOR_TYPES).sort());
    for (const { key, values } of TUTOR_PRESETS) {
      expect(values.name).toBe(TUTOR_TYPES[key]);
      expect(values.tutorType).toBe(key);
      expect(values.objectives.length).toBeGreaterThan(20);
      expect(values.questionStyle && values.strategies && values.closingCriteria).toBeTruthy();
      // Every preset passes the same validation as a teacher-made tutor.
      expect(tutorBody.safeParse(values).success).toBe(true);
      expect(TUTOR_TYPE_INFO[key]?.description).toBeTruthy();
      expect(TUTOR_TYPE_GUIDANCE[key]).toBeTruthy();
    }
  });

  it("groups types into focus and format", () => {
    expect(tutorGroup("matematico")).toBe("focus");
    expect(tutorGroup("repaso")).toBe("format");
  });

  it("detects the untouched original", () => {
    const v = presetValues("repaso")!;
    expect(matchesPreset("repaso", { ...v, rules: "  " })).toBe(true);
    expect(matchesPreset("repaso", { ...v, rules: "otra cosa" })).toBe(false);
    expect(presetValues("inventado")).toBeNull();
  });

  it("type descriptions do not promise features the app does not have", () => {
    const all = Object.values(TUTOR_TYPE_INFO)
      .map((i) => `${i.description} ${i.whenToUse}`)
      .join(" ")
      .toLowerCase();
    for (const banned of ["captura", "manuscrit", "emparejamiento", "completar espacios", "rúbrica de evaluación explícita", "evaluación de la expresión oral", "piensa en voz alta"]) {
      expect(all).not.toContain(banned);
    }
  });
});

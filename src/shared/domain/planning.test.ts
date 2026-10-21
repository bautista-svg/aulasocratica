import { describe, expect, it } from "vitest";
import { composeActivityRules, durationLabel, sanitizeProposals } from "./planning";
import { MAX_TUTOR_RULES } from "./tutors";

const base = {
  activityType: "Análisis de casos",
  title: "Título",
  instructions: "Consigna",
  objectives: "Obj",
  teacherNotes: "Notas",
  tutorType: "matematico",
  helpLevel: "intensive",
  tutorGuidance: "Guía",
  reflectionQuestions: ["¿A?", "¿B?"],
  materialRefs: ["Página 3"],
};

describe("sanitizeProposals", () => {
  it("keeps valid proposals and caps them at 3", () => {
    const out = sanitizeProposals([base, base, base, base]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ tutorType: "matematico", helpLevel: "intensive", materialRefs: ["Página 3"] });
  });

  it("fixes unknown tutor types, help levels and activity types", () => {
    const [p] = sanitizeProposals([{ ...base, tutorType: "x", helpLevel: "y", activityType: "z" }], { activityTypes: ["Comparación de fuentes"] });
    expect(p).toMatchObject({ tutorType: "pensamiento_critico", helpLevel: "moderate", activityType: "Comparación de fuentes" });
  });

  it("pads reflection questions to 2, caps them at 4 and drops proposals without consigna", () => {
    const out = sanitizeProposals([
      { ...base, reflectionQuestions: [] },
      { ...base, reflectionQuestions: ["1", "2", "3", "4", "5"] },
      { ...base, instructions: "  " },
      "basura",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.reflectionQuestions).toHaveLength(2);
    expect(out[1]!.reflectionQuestions).toEqual(["1", "2", "3", "4"]);
  });
});

describe("composeActivityRules", () => {
  it("joins guidance, tutor rules and notes", () => {
    const r = composeActivityRules({ guidance: "Preguntá X.", tutorRules: "Reglas del docente: Y", teacherNotes: "Z" });
    expect(r.text).toBe("Indicaciones para esta actividad: Preguntá X.\nReglas del docente: Y\nNotas del docente: Z");
    expect(r.dropped).toEqual([]);
  });

  it("never cuts silently: reports what does not fit", () => {
    const r = composeActivityRules({ guidance: "a".repeat(2000), tutorRules: "b".repeat(2000), teacherNotes: "c" });
    expect(r.text.length).toBeLessThanOrEqual(MAX_TUTOR_RULES);
    expect(r.dropped).toEqual(["tutor"]);
    expect(r.text).toContain("Notas del docente: c");
  });
});

describe("durationLabel", () => {
  it("formats minutes", () => {
    expect(durationLabel(45)).toBe("45 min");
    expect(durationLabel(80)).toBe("1 h 20 min");
    expect(durationLabel(120)).toBe("2 h");
    expect(durationLabel(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { MAX_CONSIGNAS, consignasOf, joinFinalAnswers, readFinalAnswers, sanitizeMoreInstructions } from "./consignas";
import { buildTutorPrompt, type TutorPromptInput } from "./tutor-prompt";

describe("several consignas", () => {
  it("keeps the extra consignas trimmed, non-empty and within the limit", () => {
    expect(sanitizeMoreInstructions(["  Segunda  ", "", 3, "Tercera"], 100)).toEqual(["Segunda", "Tercera"]);
    expect(sanitizeMoreInstructions(Array.from({ length: 20 }, (_, i) => `C${i}`), 100)).toHaveLength(MAX_CONSIGNAS - 1);
    expect(sanitizeMoreInstructions("x", 100)).toEqual([]);
    expect(consignasOf({ instructions: " Primera ", moreInstructions: ["Segunda"] })).toEqual(["Primera", "Segunda"]);
    expect(consignasOf({ instructions: "Única" })).toEqual(["Única"]);
  });

  it("joins the answers under their consigna numbers (one answer stays as it is)", () => {
    expect(joinFinalAnswers(["Sola"])).toBe("Sola");
    expect(joinFinalAnswers(["Uno", " Dos "])).toBe("Consigna 1:\nUno\n\nConsigna 2:\nDos");
    expect(readFinalAnswers(["a", 2])).toEqual(["a", ""]);
    expect(readFinalAnswers(null)).toEqual([]);
  });

  it("tells the tutor to go through them in order, one at a time", () => {
    const base: TutorPromptInput = {
      title: "Esparta y Atenas",
      subject: "Historia",
      objectives: "",
      instructions: "Revisá tus notas Cornell.",
      moreInstructions: ["Conversá con el tutor sobre lo que aprendiste."],
      material: "",
      files: [],
      tutorType: "metacognicion",
      helpLevel: "moderate",
      teacherRules: "",
      voiceLanguage: "off",
      requireInitialAnswer: false,
      initialAnswer: null,
      hintCount: 0,
      recentConversation: "",
    };
    const p = buildTutorPrompt(base);
    expect(p.stable).toContain("CONSIGNAS (2, en orden)");
    expect(p.stable).toContain("### Consigna 1\nRevisá tus notas Cornell.");
    expect(p.stable).toContain("### Consigna 2\nConversá con el tutor");
    expect(p.stable).toContain("de a una y en orden");
    expect(buildTutorPrompt({ ...base, moreInstructions: [] }).stable).toContain("### Consigna\nRevisá tus notas Cornell.");
  });
});

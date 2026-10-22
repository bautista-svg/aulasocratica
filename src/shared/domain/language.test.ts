import { describe, expect, it } from "vitest";
import { intentMessages, intentText, languageOf, reflectionQuestionsIn } from "./language";
import { DEFAULT_REFLECTION_QUESTIONS } from "./activity-design";
import { buildTutorPrompt, type TutorPromptInput } from "./tutor-prompt";

describe("activity language", () => {
  it("gives the help buttons in each language and recognizes both", () => {
    expect(intentText("hint", "en")).toEqual({ label: "I need a hint", message: "I need a hint." });
    expect(intentText("hint", "es").message).toBe("Necesito una pista.");
    expect(intentMessages("other_idea")).toEqual(["Tengo otra idea:", "I have another idea:"]);
    expect(languageOf("fr")).toBe("es");
  });

  it("reads the default reflection questions in English, never the teacher's own", () => {
    const own = { key: "x", question: "¿Qué harías distinto?" };
    const out = reflectionQuestionsIn([...DEFAULT_REFLECTION_QUESTIONS, own], "en");
    expect(out.map((q) => q.question)).toEqual(["What did you discover during the activity?", "What did you change in your answer, and why?", "¿Qué harías distinto?"]);
    expect(reflectionQuestionsIn(DEFAULT_REFLECTION_QUESTIONS, "es")).toEqual(DEFAULT_REFLECTION_QUESTIONS);
  });

  it("tells the tutor to answer in English in English activities", () => {
    const base: TutorPromptInput = {
      title: "Thinking about my thinking",
      subject: "English",
      objectives: "",
      instructions: "Review your Cornell notes.",
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
    expect(buildTutorPrompt({ ...base, language: "en" }).stable).toContain("Respondé SIEMPRE en inglés");
    expect(buildTutorPrompt(base).stable).not.toContain("## IDIOMA");
  });
});

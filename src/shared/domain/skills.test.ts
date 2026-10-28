import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILLS,
  DEFAULT_SKILL_SETTINGS,
  clampThresholds,
  enabledSkills,
  findIndicator,
  levelByCount,
  levelFromIndicators,
  sanitizeAssessments,
  sanitizeSkillSettings,
  setThreshold,
  skillCatalog,
  suggestedThresholds,
  thresholdBands,
  thresholdsKey,
  toStatus,
  toneOf,
} from "./skills";

describe("skills", () => {
  it("reads the levels the AI writes in any form", () => {
    expect(toStatus("Logrado")).toBe("logrado");
    expect(toStatus("En desarrollo")).toBe("en_desarrollo");
    expect(toStatus("Sin evidencia suficiente")).toBe("sin_evidencia");
    expect(toStatus("regular")).toBeNull();
  });

  it("gives each color one meaning", () => {
    expect([toneOf("logrado"), toneOf("avanzado")]).toEqual(["good", "good"]);
    expect([toneOf("inicial"), toneOf("en_desarrollo")]).toEqual(["grow", "grow"]);
    expect([toneOf("sin_evidencia"), toneOf(null)]).toEqual(["none", "none"]);
  });

  it("defaults to the eight skills in three dimensions plus Redacción, and orders by dimension", () => {
    const on = enabledSkills(sanitizeSkillSettings(null));
    expect(on.map((s) => s.key)).toEqual(["argumentacion", "creatividad", "comprension", "pensamiento_critico", "reflexion", "revision", "dialogo", "materiales", "redaccion"]);
    expect(DEFAULT_SKILL_SETTINGS.enabled).toHaveLength(9);
  });

  it("keeps only valid own skills and known keys", () => {
    const s = sanitizeSkillSettings({
      enabled: ["argumentacion", "c_abcd1234", "c_nope", "argumentacion"],
      custom: [
        { id: "c_abcd1234", label: "  Trabajo   con fuentes ", dimension: "proceso", criteria: ["Cita la fuente.", "", "x".repeat(300)] },
        { id: "malo", label: "Sin id válido", dimension: "proceso", criteria: ["Algo."] },
        { id: "c_sincrit", label: "Sin indicadores", dimension: "proceso", criteria: [] },
      ],
    });
    expect(s.enabled).toEqual(["argumentacion", "c_abcd1234"]);
    expect(s.custom).toHaveLength(1);
    expect(s.custom[0]).toMatchObject({ label: "Trabajo con fuentes", dimension: "proceso" });
    expect(s.custom[0]!.criteria[1]).toHaveLength(200);
    expect(skillCatalog(s).find((c) => c.key === "c_abcd1234")).toMatchObject({ custom: true });
  });

  it("evaluates only the indicators the teacher left ticked", () => {
    const s = sanitizeSkillSettings({
      enabled: ["argumentacion", "redaccion"],
      off: { argumentacion: ["Utiliza evidencias para sostener sus ideas."], redaccion: BUILTIN_SKILLS.redaccion.criteria, nada: ["x"] },
    });
    // All of a skill unticked would leave nothing to look for: it keeps them all.
    expect(s.off).toEqual({ argumentacion: ["Utiliza evidencias para sostener sus ideas."] });
    const on = enabledSkills(s);
    expect(on.find((x) => x.key === "argumentacion")!.criteria).toEqual(["Justifica sus respuestas.", "Explica las razones de sus decisiones."]);
    expect(on.find((x) => x.key === "redaccion")!.criteria).toHaveLength(3);
    expect(skillCatalog(s).find((x) => x.key === "argumentacion")!.criteria).toHaveLength(3);
  });

  it("finds the indicator the AI named, even copied with small changes", () => {
    const list = BUILTIN_SKILLS.argumentacion.criteria;
    expect(findIndicator("Justifica sus respuestas.", list)).toBe("Justifica sus respuestas.");
    expect(findIndicator("justifica su respuesta", list)).toBe("Justifica sus respuestas.");
    expect(findIndicator("Utiliza evidencia para sostener ideas", list)).toBe("Utiliza evidencias para sostener sus ideas.");
    expect(findIndicator("Relaciona conceptos entre sí.", list)).toBeNull();
    expect(findIndicator("", list)).toBeNull();
  });
});

describe("how many indicators each level asks for (Vanina Gerstner, 28-10)", () => {
  const t = (inicial: number, en_desarrollo: number, logrado: number, avanzado: number) => ({ inicial, en_desarrollo, logrado, avanzado });

  it("suggests numbers to start from, and none with fewer than two ticked indicators", () => {
    expect(suggestedThresholds(1)).toBeNull();
    expect(suggestedThresholds(2)).toEqual(t(0, 0, 1, 2));
    expect(suggestedThresholds(3)).toEqual(t(0, 1, 2, 3));
    expect(suggestedThresholds(4)).toEqual(t(0, 1, 3, 4));
    expect(suggestedThresholds(6)).toEqual(t(0, 1, 4, 6));
  });

  it("fits stored numbers to the ticked indicators: whole, never above them, never decreasing, Logrado at least one", () => {
    expect(clampThresholds(t(0, 1, 3, 4), 4)).toEqual(t(0, 1, 3, 4));
    // Fewer indicators ticked: nothing asks for more than there are.
    expect(clampThresholds(t(0, 1, 3, 4), 3)).toEqual(t(0, 1, 3, 3));
    expect(clampThresholds(t(0, 2, 1, 0), 4)).toEqual(t(0, 2, 2, 2));
    expect(clampThresholds(t(-3, 0.6, 0, 9), 4)).toEqual(t(0, 1, 1, 4));
    expect(clampThresholds(t(0, 1, 3, 4), 1)).toBeNull();
    expect(clampThresholds({ inicial: 0, logrado: 2 }, 4)).toBeNull();
    expect(clampThresholds("3", 4)).toBeNull();
    expect(clampThresholds({ ...t(0, 1, 2, 3), avanzado: Number.NaN }, 4)).toBeNull();
  });

  it("moves the other levels only as much as needed when the teacher changes one", () => {
    const base = t(0, 1, 3, 4);
    expect(setThreshold(base, "logrado", 2, 4)).toEqual(t(0, 1, 2, 4));
    // Asking more for En desarrollo than Logrado asks pushes Logrado (and Avanzado) up.
    expect(setThreshold(base, "en_desarrollo", 4, 4)).toEqual(t(0, 4, 4, 4));
    // Asking less for Avanzado pulls the lower levels down.
    expect(setThreshold(base, "avanzado", 2, 4)).toEqual(t(0, 1, 2, 2));
    // Never outside its range.
    expect(setThreshold(base, "logrado", 0, 4)).toEqual(t(0, 1, 1, 4));
    expect(setThreshold(base, "inicial", 7, 4)).toEqual(t(4, 4, 4, 4));
  });

  it("gives the highest level the count reaches; with none, the AI chooses among the levels that ask for none", () => {
    const four = t(0, 1, 3, 4);
    expect(levelByCount(2, four)).toBe("en_desarrollo");
    expect(levelFromIndicators(3, four, "en_desarrollo")).toBe("logrado");
    // The AI's level does not decide when the student showed indicators.
    expect(levelFromIndicators(2, four, "avanzado")).toBe("en_desarrollo");
    expect(levelFromIndicators(4, four, "inicial")).toBe("avanzado");
    expect(levelFromIndicators(1, four, "sin_evidencia")).toBe("en_desarrollo");
    // None shown: only Inicial asks for none, so it is Inicial at most.
    expect(levelFromIndicators(0, four, "logrado")).toBe("inicial");
    expect(levelFromIndicators(0, four, "sin_evidencia")).toBe("sin_evidencia");
    expect(levelFromIndicators(0, t(0, 0, 2, 3), "en_desarrollo")).toBe("en_desarrollo");
    expect(levelFromIndicators(0, t(0, 0, 2, 3), "avanzado")).toBe("en_desarrollo");
    // Fewer than Inicial asks for: not enough evidence.
    expect(levelFromIndicators(1, t(2, 2, 3, 4), "logrado")).toBe("sin_evidencia");
    // Two levels with the same number: the higher one.
    expect(levelFromIndicators(2, t(0, 1, 2, 2), "logrado")).toBe("avanzado");
  });

  it("describes the rule in bands for the teacher", () => {
    expect(thresholdBands(t(0, 1, 3, 4), 4)).toEqual([
      { from: 0, to: 0, levels: ["inicial"] },
      { from: 1, to: 2, levels: ["en_desarrollo"] },
      { from: 3, to: 3, levels: ["logrado"] },
      { from: 4, to: 4, levels: ["avanzado"] },
    ]);
    expect(thresholdBands(t(1, 1, 2, 2), 3)).toEqual([
      { from: 0, to: 0, levels: [] },
      { from: 1, to: 1, levels: ["en_desarrollo"] },
      { from: 2, to: 3, levels: ["avanzado"] },
    ]);
    expect(thresholdBands(t(0, 0, 1, 2), 2)[0]).toEqual({ from: 0, to: 0, levels: ["inicial", "en_desarrollo"] });
  });

  it("keeps the numbers per skill in the settings, fitted to the indicators ticked now", () => {
    const s = sanitizeSkillSettings({
      enabled: ["argumentacion", "comprension"],
      off: { comprension: ["Relaciona conceptos entre sí."] },
      levels: {
        argumentacion: t(0, 1, 2, 3),
        // 3 ticked: Avanzado 4 de 4 becomes 3 de 3.
        comprension: t(0, 1, 3, 4),
        // Kept while the skill is off.
        vocabulario: t(0, 0, 1, 2),
        magia: t(0, 1, 2, 3),
      },
    });
    expect(s.levels).toEqual({ argumentacion: t(0, 1, 2, 3), comprension: t(0, 1, 3, 3), vocabulario: t(0, 0, 1, 2) });
    const on = enabledSkills(s);
    expect(on.map((x) => x.levels ?? null)).toEqual([t(0, 1, 2, 3), t(0, 1, 3, 3)]);
    expect(sanitizeSkillSettings({ enabled: ["argumentacion"] }).levels).toEqual({});
    expect(enabledSkills(sanitizeSkillSettings(null)).every((x) => x.levels === null)).toBe(true);
    expect(thresholdsKey(t(0, 1, 3, 4))).toBe("0-1-3-4");
    expect(thresholdsKey(null)).toBe("");
  });

  it("reads stored evaluations with or without the indicators shown", () => {
    const [old] = sanitizeAssessments([{ skill: "argumentacion", status: "logrado", criterion: "Justifica sus respuestas.", evidence: "porque sí" }]);
    expect(old).toMatchObject({ met: [], of: 0, levels: null });
    const [now] = sanitizeAssessments([
      {
        skill: "argumentacion",
        status: "logrado",
        met: [
          { criterion: "Justifica sus respuestas.", evidence: "porque sí" },
          { criterion: "", evidence: "x" },
          { criterion: "Justifica sus respuestas.", evidence: "otra" },
        ],
        of: 3,
        levels: t(0, 1, 1, 3),
      },
    ]);
    expect(now).toMatchObject({ met: [{ criterion: "Justifica sus respuestas.", evidence: "porque sí" }], of: 3, levels: t(0, 1, 1, 3) });
  });
});

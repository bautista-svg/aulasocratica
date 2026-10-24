import { describe, expect, it } from "vitest";
import { BUILTIN_SKILLS, DEFAULT_SKILL_SETTINGS, enabledSkills, findIndicator, sanitizeSkillSettings, skillCatalog, toStatus, toneOf } from "./skills";

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

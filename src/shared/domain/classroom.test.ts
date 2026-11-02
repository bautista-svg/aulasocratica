import { describe, expect, it } from "vitest";
import { foldName, gradeFromRubric, matchStudent } from "./classroom";
import type { RubricCriterion } from "./activity-design";

const level = (label: string) => ({ label, description: "" });
const rubric: RubricCriterion[] = [
  { id: "a", name: "Usa evidencia", description: "", levels: [level("Inicial"), level("En proceso"), level("Logrado"), level("Avanzado")] },
  { id: "b", name: "Argumenta", description: "", levels: [level("Inicial"), level("En proceso"), level("Logrado"), level("Avanzado")] },
];

describe("nota desde la rúbrica", () => {
  it("cada criterio vale lo mismo y cada nivel su lugar", () => {
    expect(gradeFromRubric(rubric, { a: 3, b: 3 }, 10)).toBe(10);
    expect(gradeFromRubric(rubric, { a: 2, b: 1 }, 10)).toBe(6.3);
    expect(gradeFromRubric(rubric, { a: 0, b: 0 }, 100)).toBe(25);
  });

  it("sin niveles no hay nota; un criterio sin nivel no cuenta", () => {
    expect(gradeFromRubric(rubric, {}, 10)).toBeNull();
    expect(gradeFromRubric(rubric, { a: null, b: 3 }, 10)).toBe(10);
    expect(gradeFromRubric([], { a: 1 }, 10)).toBeNull();
  });
});

describe("emparejar alumnos con Classroom", () => {
  const roster = [
    { userId: "1", name: "Martina López" },
    { userId: "2", name: "Tomás Ruiz" },
    { userId: "3", name: "Lucía Sofía Paz" },
    { userId: "4", name: "Juan Pérez" },
    { userId: "5", name: "Juan Pérez" },
  ];

  it("encuentra al mismo nombre sin importar tildes, mayúsculas ni el orden", () => {
    expect(foldName("  Martína  LÓPEZ ")).toBe("martina lopez");
    expect(matchStudent("martina lopez", roster)?.userId).toBe("1");
    expect(matchStudent("Ruiz Tomás", roster)?.userId).toBe("2");
    expect(matchStudent("Lucía Paz", roster)?.userId).toBe("3");
  });

  it("no adivina cuando hay dudas", () => {
    expect(matchStudent("Juan Pérez", roster)).toBeNull();
    expect(matchStudent("Martina", roster)).toBeNull();
    expect(matchStudent("Pedro Gómez", roster)).toBeNull();
  });
});

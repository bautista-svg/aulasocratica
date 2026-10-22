import { describe, expect, it } from "vitest";
import { sanitizeSummary, withFullObjectives } from "./session-summary";

const long =
  "Investigar las características de los planetas del Sistema Solar mediante un diálogo socrático con la inteligencia artificial, desarrollando habilidades de comprensión, pensamiento crítico, argumentación y comunicación oral y escrita.";

describe("objective titles", () => {
  it("keeps long objectives whole", () => {
    const s = sanitizeSummary({ overview: "x", criteria: [], objectives: [{ title: long, observation: "Hay avance.", evidence: [] }], nextSteps: [] });
    expect(s.objectives[0]!.title).toBe(long);
  });

  it("shows the full objective for titles cut before (200 characters) or shortened by the AI", () => {
    const cut = { title: long.slice(0, 200).trim(), observation: "Hay avance.", evidence: [] };
    const dotted = { title: `${long.slice(0, 80)}…`, observation: "Algo.", evidence: [] };
    const other = { title: "Comparar planetas", observation: "Falta.", evidence: [] };
    const out = withFullObjectives([cut, dotted, other], [long, "Comparar planetas rocosos y gaseosos"]);
    expect(out.map((p) => p.title)).toEqual([long, long, "Comparar planetas rocosos y gaseosos"]);
  });

  it("leaves titles that do not start an objective as they are", () => {
    const p = { title: "Otra cosa distinta", observation: "x", evidence: [] };
    expect(withFullObjectives([p], [long])).toEqual([p]);
  });
});

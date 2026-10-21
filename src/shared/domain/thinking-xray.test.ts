import { describe, expect, it } from "vitest";
import { tutorQuestion } from "./thinking-xray";

// The regex before the performance fix: the new one must give exactly the same matches.
function tutorQuestionOld(content: string): string | null {
  const plain = content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const matches = plain.match(/[^.!?¿¡]*¿?[^.!?¿¡]*\?/g);
  const q = matches?.map((s) => s.trim()).filter((s) => s.length > 3).pop();
  return q ? q.slice(0, 300) : null;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("tutorQuestion", () => {
  it("keeps the last real question of a tutor turn", () => {
    expect(tutorQuestion("Muy bien. ¿Qué cambia en el aire cuando subís a una montaña?")).toBe("¿Qué cambia en el aire cuando subís a una montaña?");
    expect(tutorQuestion("**Bien**: ¿por qué? Pensalo. ¿Y si fuera al revés?")).toBe("¿Y si fuera al revés?");
    expect(tutorQuestion("Sin preguntas acá.")).toBeNull();
  });

  it("matches the previous implementation on a random corpus", () => {
    const next = rng(42);
    const alphabet = ["a", "b", " ", "¿", "?", ".", "!", "¡", "*", "\n", "é", "ñ", "1", ",", "_"];
    for (let i = 0; i < 20_000; i++) {
      const len = Math.floor(next() * 120);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(next() * alphabet.length)];
      expect(tutorQuestion(s)).toBe(tutorQuestionOld(s));
    }
  });
});

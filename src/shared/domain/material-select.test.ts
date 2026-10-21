import { describe, expect, it } from "vitest";
import { splitChunks } from "./material-select";

describe("splitChunks", () => {
  it("never cuts a two-unit character (PDF math letters, emoji) in half", () => {
    // 𝑥 takes two UTF-16 units: with size 5, a naive cut would split the third one.
    const text = "ab𝑥𝑥𝑥𝑥😀cd";
    const chunks = splitChunks(text, 5);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) expect(c).toBe(c.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "!"));
  });
});

import { describe, expect, it } from "vitest";
import { wellFormed, wellFormedText } from "./well-formed";

const x = "𝑥"; // U+1D465: two UTF-16 units
const halfHigh = x[0]!;
const halfLow = x[1]!;

describe("wellFormed", () => {
  it("keeps whole characters and replaces halves cut from them", () => {
    expect(wellFormedText(`a ${x} b 😀`)).toBe(`a ${x} b 😀`);
    expect(wellFormedText(`fin ${halfHigh}`)).toBe("fin �");
    expect(wellFormedText(`${halfLow} inicio`)).toBe("� inicio");
  });

  it("produces JSON that strict parsers accept", () => {
    const body = JSON.stringify({ text: wellFormedText(`corte ${halfHigh}`) });
    expect(body).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("walks system prompts and message blocks without touching base64 data", () => {
    const data = "iVBORw0KGgo=";
    const out = wellFormed({
      system: [{ type: "text", text: `sys ${halfHigh}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }, { type: "text", text: `msg ${halfLow}` }] }],
    });
    expect(out.system[0]!.text).toBe("sys �");
    expect(out.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect((out.messages[0]!.content[0] as { source: { data: string } }).source.data).toBe(data);
    expect((out.messages[0]!.content[1] as { text: string }).text).toBe("msg �");
  });
});

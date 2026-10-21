import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, parseBlocks, splitTrailingQuestion } from "./markdown";

const html = (text: string, highlightQuestion = false) => renderToStaticMarkup(createElement(Markdown, { text, highlightQuestion }));

describe("tutor markdown", () => {
  it("parses paragraphs, lists and code blocks", () => {
    expect(parseBlocks("Hola.\n\n- uno\n- dos\n\n1. a\n2. b\n\n```\nx = 1\n```")).toEqual([
      { type: "p", text: "Hola." },
      { type: "ul", items: ["uno", "dos"] },
      { type: "ol", items: ["a", "b"], start: 1 },
      { type: "pre", text: "x = 1" },
    ]);
  });

  it("renders bold, italic and code, and never raw HTML", () => {
    const out = html('**Muy bien**, *pensalo* con `2/4`. <img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(out).toContain('<strong class="font-semibold text-ink">Muy bien</strong>');
    expect(out).toContain("<em>pensalo</em>");
    expect(out).toContain(">2/4</code>");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("shows link text without making links", () => {
    const out = html("Mirá [este sitio](https://example.com) después.");
    expect(out).toContain("Mirá este sitio después.");
    expect(out).not.toContain("href");
  });

  it("does not treat snake_case or a lone asterisk as emphasis", () => {
    const out = html("la variable mi_valor_total y 3 * 4 = 12");
    expect(out).not.toContain("<em>");
  });

  it("tolerates half-written markup while streaming", () => {
    expect(html("Esto es **impor")).toContain("Esto es **impor");
  });

  it("splits the closing question of a reply", () => {
    expect(splitTrailingQuestion("Muy bien. ¿Y si probás con 3/6?")).toEqual({ lead: "Muy bien.", question: "¿Y si probás con 3/6?" });
    expect(splitTrailingQuestion("¿Por qué?")).toEqual({ lead: "", question: "¿Por qué?" });
    expect(splitTrailingQuestion("Good job. What do you think?")).toEqual({ lead: "Good job.", question: "What do you think?" });
    expect(splitTrailingQuestion("Sin pregunta.")).toBeNull();
  });

  it("hangs the '?' only on the closing question when asked to", () => {
    expect(html("Bien pensado. ¿Cómo lo sabés?", true)).toContain('<p class="q-hang');
    expect(html("Bien pensado. ¿Cómo lo sabés?", false)).not.toContain("q-hang");
  });
});

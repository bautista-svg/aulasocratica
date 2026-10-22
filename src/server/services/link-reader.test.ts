import { describe, expect, it } from "vitest";
import { googleExport, readGoogleLink } from "./link-reader";
import { linkLabel, validateDeliverableLink } from "@shared/domain/deliverables";

type Call = { url: string; init: RequestInit };
const fake = (replies: ((url: string) => Response)[]) => {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return next(url);
  };
  return { f, calls };
};

describe("delivery links", () => {
  it("validates and labels links for people", () => {
    expect(validateDeliverableLink("docs.google.com/document/d/abcdefghijk/edit")).toMatchObject({
      ok: true,
      url: "https://docs.google.com/document/d/abcdefghijk/edit",
      label: "Documento de Google",
    });
    expect(validateDeliverableLink("javascript:alert(1)").ok).toBe(false);
    expect(validateDeliverableLink("hola").ok).toBe(false);
    expect(validateDeliverableLink("").ok).toBe(false);
    expect(linkLabel("https://drive.google.com/file/d/abc/view")).toBe("Archivo de Google Drive");
    expect(linkLabel("https://docs.google.com/presentation/d/abc/edit")).toBe("Presentación de Google");
    expect(linkLabel("https://youtu.be/xyz")).toBe("Video de YouTube");
    expect(linkLabel("https://www.padlet.com/ana")).toBe("padlet.com");
  });

  it("knows how to export Google Docs, Slides, Sheets and Drive files, and nothing else", () => {
    expect(googleExport("https://docs.google.com/document/d/1AbCdEfGhIjK/edit")?.url).toBe("https://docs.google.com/document/d/1AbCdEfGhIjK/export?format=txt");
    expect(googleExport("https://docs.google.com/presentation/d/1AbCdEfGhIjK/edit#slide=id.p")?.url).toBe(
      "https://docs.google.com/presentation/d/1AbCdEfGhIjK/export/txt",
    );
    expect(googleExport("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/edit")?.url).toBe("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK/export?format=csv");
    expect(googleExport("https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing")).toEqual({
      url: "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK",
      text: false,
    });
    expect(googleExport("https://drive.google.com/open?id=1AbCdEfGhIjK")?.url).toContain("id=1AbCdEfGhIjK");
    expect(googleExport("http://docs.google.com/document/d/1AbCdEfGhIjK/edit")).toBeNull();
    expect(googleExport("https://evil.example/document/d/1AbCdEfGhIjK")).toBeNull();
    expect(googleExport("https://docs.google.com.evil.example/document/d/1AbCdEfGhIjK")).toBeNull();
    expect(googleExport("https://drive.google.com/drive/folders/1AbCdEfGhIjK")).toBeNull();
  });

  it("follows Google redirects only and reads a Drive PDF", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const { f, calls } = fake([
      () => new Response(null, { status: 303, headers: { location: "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjK" } }),
      () => new Response(pdf, { headers: { "content-type": "application/pdf" } }),
    ]);
    const r = await readGoogleLink("https://drive.google.com/file/d/1AbCdEfGhIjK/view", f);
    expect(r).toMatchObject({ kind: "pdf", mime: "application/pdf" });
    expect(r.data).toEqual(pdf);
    expect(calls.map((c) => c.url)).toEqual(["https://drive.google.com/uc?export=download&id=1AbCdEfGhIjK", "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjK"]);
    expect(calls.every((c) => c.init.redirect === "manual")).toBe(true);
  });

  it("never follows a redirect outside Google, and treats sign-in or HTML pages as not public", async () => {
    const outside = fake([() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })]);
    await expect(readGoogleLink("https://docs.google.com/document/d/1AbCdEfGhIjK/edit", outside.f)).rejects.toMatchObject({ code: "link_not_public" });
    expect(outside.calls).toHaveLength(1);

    const html = fake([() => new Response("<html>Iniciar sesión</html>", { headers: { "content-type": "text/html; charset=utf-8" } })]);
    await expect(readGoogleLink("https://docs.google.com/document/d/1AbCdEfGhIjK/edit", html.f)).rejects.toMatchObject({ code: "link_not_public" });

    const notGoogle = fake([]);
    await expect(readGoogleLink("https://example.com/informe.pdf", notGoogle.f)).rejects.toMatchObject({ code: "link_not_public" });
    expect(notGoogle.calls).toHaveLength(0);
  });

  it("rejects Drive files it cannot read and files over the limit", async () => {
    const zip = fake([() => new Response("PK", { headers: { "content-type": "application/zip" } })]);
    await expect(readGoogleLink("https://drive.google.com/file/d/1AbCdEfGhIjK/view", zip.f)).rejects.toMatchObject({ code: "link_unsupported" });
    const big = fake([() => new Response("x", { headers: { "content-type": "application/pdf", "content-length": String(30 * 1024 * 1024) } })]);
    await expect(readGoogleLink("https://drive.google.com/file/d/1AbCdEfGhIjK/view", big.f)).rejects.toMatchObject({ code: "link_too_big" });
  });
});

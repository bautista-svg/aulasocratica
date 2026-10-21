import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { streamSSE } from "hono/streaming";
import { compressBuffered, pickEncoding } from "./compress";

const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, text: "Una respuesta del tutor con una pregunta" })) };

function app() {
  const a = new Hono();
  a.use("*", compress());
  a.use("*", compressBuffered);
  a.get("/big", (c) => c.json(big));
  a.get("/small", (c) => c.json({ ok: true }));
  a.get("/csv", (c) => c.body("a,b\n".repeat(1000), 200, { "Content-Type": "text/csv" }));
  a.get("/sse", (c) => streamSSE(c, async (s) => s.writeSSE({ data: "x".repeat(2000) })));
  return a;
}

describe("pickEncoding", () => {
  it("prefers Brotli, honours q-values and wildcards", () => {
    expect(pickEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0.5, gzip;q=0.9")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip;q=0")).toBeNull();
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });
});

describe("compressBuffered", () => {
  it("compresses large JSON with the accepted encoding and sets its length", async () => {
    const br = await app().request("/big", { headers: { "accept-encoding": "gzip, br" } });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("vary")).toBe("Accept-Encoding");
    const raw = Buffer.from(await br.arrayBuffer());
    expect(Number(br.headers.get("content-length"))).toBe(raw.length);
    expect(JSON.parse(zlib.brotliDecompressSync(raw).toString())).toEqual(big);

    const gz = await app().request("/big", { headers: { "accept-encoding": "gzip" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(zlib.gunzipSync(Buffer.from(await gz.arrayBuffer())).toString())).toEqual(big);

    const plain = await app().request("/big");
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(await plain.json()).toEqual(big);
  });

  it("leaves small bodies uncompressed and other types to hono/compress", async () => {
    const small = await app().request("/small", { headers: { "accept-encoding": "gzip, br" } });
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(await small.json()).toEqual({ ok: true });

    const csv = await app().request("/csv", { headers: { "accept-encoding": "gzip, br" } });
    expect(csv.headers.get("content-encoding")).toBe("gzip");

    const sse = await app().request("/sse", { headers: { "accept-encoding": "gzip, br" } });
    expect(sse.headers.get("content-encoding")).toBeNull();
    expect(await sse.text()).toContain("data: xxx");
  });
});

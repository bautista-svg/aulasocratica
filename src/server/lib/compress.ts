// Compression of the JSON and HTML that the app builds in memory. Registered right after
// hono/compress (so it runs first on the way out): it compresses those bodies with node:zlib
// asynchronously — in libuv's thread pool, not on the event loop — and only above 1 KB, with
// Brotli when the browser accepts it. hono/compress compressed every JSON body, even 40-byte
// ones, through a web CompressionStream on the main thread; it still handles everything else
// (e.g. text files streamed from disk), and skips what this middleware already encoded.
// Same rules as hono/compress otherwise: never SSE, never `no-transform`, nothing already encoded,
// `Vary: Accept-Encoding`.
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { MiddlewareHandler } from "hono";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const THRESHOLD = 1024;
const BUFFERED = /^\s*(?:application\/json|text\/html)(?:[;\s]|$)/i;
const NO_TRANSFORM = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
const VARY_ACCEPT_ENCODING = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
const BROTLI_OPTIONS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } };

/** Preferred encoding from Accept-Encoding (q-values honoured; Brotli first on ties). */
export function pickEncoding(header: string | undefined): "br" | "gzip" | null {
  if (!header) return null;
  const q = new Map<string, number>();
  let wildcard = 0;
  for (const part of header.split(",")) {
    const [name = "", ...params] = part.split(";");
    const qp = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith("q="));
    const raw = qp ? Number(qp.slice(2)) : 1;
    const value = Number.isFinite(raw) ? raw : 0;
    const key = name.trim().toLowerCase();
    if (key === "*") wildcard = value;
    else if (key) q.set(key, value);
  }
  let best: { enc: "br" | "gzip"; q: number } | null = null;
  for (const enc of ["br", "gzip"] as const) {
    const v = q.get(enc) ?? wildcard;
    if (v > 0 && (!best || v > best.q)) best = { enc, q: v };
  }
  return best?.enc ?? null;
}

export const compressBuffered: MiddlewareHandler = async (c, next) => {
  await next();
  const res = c.res;
  if (
    !BUFFERED.test(res.headers.get("Content-Type") ?? "") ||
    res.status === 206 ||
    res.headers.has("Content-Encoding") ||
    res.headers.has("Transfer-Encoding") ||
    c.req.method === "HEAD" ||
    !res.body ||
    NO_TRANSFORM.test(res.headers.get("Cache-Control") ?? "")
  ) {
    return;
  }
  const body = Buffer.from(await res.arrayBuffer());
  const encoding = body.length >= THRESHOLD ? pickEncoding(c.req.header("Accept-Encoding")) : null;
  const out = encoding === "br" ? await brotli(body, BROTLI_OPTIONS) : encoding === "gzip" ? await gzip(body) : body;
  c.res = new Response(new Uint8Array(out.buffer, out.byteOffset, out.byteLength), res);
  const vary = c.res.headers.get("Vary");
  if (vary !== "*" && !(vary && VARY_ACCEPT_ENCODING.test(vary))) c.res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  // A known length also tells hono/compress to leave bodies under its threshold alone.
  c.res.headers.set("Content-Length", String(out.length));
  if (encoding) {
    c.res.headers.set("Content-Encoding", encoding);
    const etag = c.res.headers.get("ETag");
    if (etag && !etag.startsWith("W/")) c.res.headers.set("ETag", `W/${etag}`);
  }
};

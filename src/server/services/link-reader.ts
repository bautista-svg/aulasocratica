// Reads what a student handed in as a Google link (Docs, Slides, Sheets or a file in Drive) when it
// is shared as "Cualquier persona con el enlace", so the teacher can analyze it with the rubric.
// Only Google hosts are ever contacted, also across redirects: any other link is kept for the
// teacher to open, never fetched by the server (no requests to arbitrary or internal addresses).
import { HttpError } from "../lib/errors";
import { MAX_DELIVERABLE_BYTES } from "@shared/domain/deliverables";
import { MAX_IMAGE_BYTES, type FileKind } from "@shared/domain/files";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 20_000;
const MAX_HOPS = 5;

const isGoogleHost = (h: string) =>
  h === "docs.google.com" || h === "drive.google.com" || h === "drive.usercontent.google.com" || h.endsWith(".googleusercontent.com");

const ID = /^[\w-]{10,200}$/;

/** The export address of a Google link, or null when it is not one we can read. */
export function googleExport(raw: string): { url: string; text: boolean } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host === "docs.google.com") {
    const m = /^\/(document|presentation|spreadsheets)\/d\/([^/]+)/.exec(u.pathname);
    if (!m || !ID.test(m[2]!)) return null;
    const id = m[2]!;
    if (m[1] === "document") return { url: `https://docs.google.com/document/d/${id}/export?format=txt`, text: true };
    if (m[1] === "presentation") return { url: `https://docs.google.com/presentation/d/${id}/export/txt`, text: true };
    return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`, text: true };
  }
  if (host === "drive.google.com") {
    const id = /^\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? (u.pathname === "/open" || u.pathname === "/uc" ? u.searchParams.get("id") : null);
    if (!id || !ID.test(id)) return null;
    return { url: `https://drive.google.com/uc?export=download&id=${id}`, text: false };
  }
  return null;
}

export const LINK_NOT_PUBLIC =
  "No se pudo abrir el enlace: tiene que estar compartido como «Cualquier persona con el enlace». Pedile al alumno que lo comparta así, o que suba el archivo.";
const LINK_UNSUPPORTED = "Ese archivo de Drive no se puede leer (se leen PDF, Word, texto y fotos). Pedile al alumno que lo suba como PDF.";
const LINK_TOO_BIG = "El archivo del enlace es demasiado grande para leerlo. Pedile al alumno que lo suba más liviano o como PDF.";

const notPublic = () => new HttpError(422, LINK_NOT_PUBLIC, "link_not_public");

function kindOf(mime: string): FileKind | null {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") return "image";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "text/plain" || mime === "text/csv" || mime === "text/markdown") return "text";
  return null;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(422, LINK_TOO_BIG, "link_too_big");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Downloads a public Google link as a file the extractor can read. */
export async function readGoogleLink(raw: string, fetchImpl: Fetch = fetch): Promise<{ data: Uint8Array; kind: FileKind; mime: string }> {
  const target = googleExport(raw);
  if (!target) throw notPublic();
  let url = target.url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(url);
    // A private document redirects to the Google sign-in page (accounts.google.com): not readable.
    if (u.protocol !== "https:" || !isGoogleHost(u.hostname.toLowerCase())) throw notPublic();
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "*/*" } });
    } catch {
      throw new HttpError(503, "Google no respondió al abrir el enlace. Probá de nuevo en un rato.", "link_unreachable");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw notPublic();
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw notPublic();
    }
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    // HTML is a sign-in page, a permission page or Drive's "too big to scan" page: not the work.
    if (mime === "text/html") {
      await res.body?.cancel().catch(() => {});
      throw notPublic();
    }
    const kind = target.text ? "text" : kindOf(mime);
    if (!kind) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(422, LINK_UNSUPPORTED, "link_unsupported");
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_DELIVERABLE_BYTES;
    if (declared > max) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(422, LINK_TOO_BIG, "link_too_big");
    }
    const data = await readCapped(res, max);
    return { data, kind, mime: target.text ? "text/plain" : mime };
  }
  throw notPublic();
}

// Tests replace the network (no real requests to Google from the test suite).
let linkFetch: Fetch = (url, init) => fetch(url, init);
export function setLinkFetch(f: Fetch | null) {
  linkFetch = f ?? ((url, init) => fetch(url, init));
}
export const readLinkForJob = (raw: string) => readGoogleLink(raw, linkFetch);

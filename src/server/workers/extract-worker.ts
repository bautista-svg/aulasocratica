// Runs local text extraction (PDF text layer, Word .docx) in an isolated worker thread with
// a hard memory limit, so a malicious file (e.g. a decompression bomb) can only kill this
// worker — never the API process. Self-contained on purpose: only bare package imports.
import { parentPort, workerData } from "node:worker_threads";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

type Task = { kind: "pdf" | "docx"; data: Uint8Array };
type Result = { ok: true; pages?: string[]; totalPages?: number; text?: string } | { ok: false; code: string };

/** Max total uncompressed size declared by a .docx (zip). Real documents are far below this. */
const MAX_DOCX_UNCOMPRESSED = 80 * 1024 * 1024;

/** Sums the uncompressed sizes in the zip central directory (no decompression needed). */
function declaredZipSize(buf: Uint8Array): number | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  const min = Math.max(0, buf.byteLength - 65_557);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) return null;
    const uncompressed = dv.getUint32(p + 24, true);
    if (uncompressed === 0xffffffff) return Number.MAX_SAFE_INTEGER; // zip64: refuse
    total += uncompressed;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

async function run(task: Task): Promise<Result> {
  if (task.kind === "pdf") {
    try {
      const pdf = await getDocumentProxy(task.data);
      const r = await extractText(pdf, { mergePages: false });
      return { ok: true, pages: r.text, totalPages: r.totalPages };
    } catch {
      return { ok: false, code: "pdf_unreadable" };
    }
  }
  const size = declaredZipSize(task.data);
  if (size === null) return { ok: false, code: "docx_unreadable" };
  if (size > MAX_DOCX_UNCOMPRESSED) return { ok: false, code: "docx_too_large" };
  try {
    const r = await mammoth.extractRawText({ buffer: Buffer.from(task.data) });
    return { ok: true, text: r.value };
  } catch {
    return { ok: false, code: "docx_unreadable" };
  }
}

run(workerData as Task)
  .then((r) => parentPort?.postMessage(r))
  .catch(() => parentPort?.postMessage({ ok: false, code: "failed" }));

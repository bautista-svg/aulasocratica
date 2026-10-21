// Regression test for the security review finding F-01: a .docx decompression bomb must not
// take the API down (extraction runs in an isolated worker with size and memory limits).
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { call, newClassroom, newTeacher } from "./helpers";
import { waitForFile } from "@server/services/file-jobs";

const require = createRequire(import.meta.url);
// jszip ships with mammoth; only used here to build the malicious file.
const JSZip = require("jszip") as new () => {
  file: (name: string, data: string) => void;
  generateAsync: (o: object) => Promise<Buffer>;
};

async function docxBomb(mb: number): Promise<Buffer> {
  const para = "<w:p><w:r><w:t>a</w:t></w:r></w:p>";
  const body = para.repeat(Math.ceil((mb * 1024 * 1024) / para.length));
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

describe("upload safety", () => {
  it("rejects a .docx decompression bomb without affecting the server", async () => {
    const t = await newTeacher();
    const classroomId = await newClassroom(t.cookie);
    const act = await call("POST", "/api/activities", { cookie: t.cookie, body: { classroomId, title: "Bomba" } });
    const bomb = await docxBomb(100);
    expect(bomb.byteLength).toBeLessThan(2 * 1024 * 1024);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bomb)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "tarea.docx");
    const up = await call("POST", `/api/activities/${act.body.activity.id}/files`, { cookie: t.cookie, form });
    expect(up.status).toBe(201);
    const fileId = up.body.files[0].id as string;
    await waitForFile({ table: "activity_files", id: fileId }, 60_000);
    const files = await call("GET", `/api/activities/${act.body.activity.id}/files`, { cookie: t.cookie });
    const f = files.body.files.find((x: { id: string }) => x.id === fileId);
    expect(f.processingStatus).toBe("failed");
    expect(f.processingError).toMatch(/demasiado grande/);
    expect((await call("GET", "/api/health")).status).toBe(200);
  }, 120_000);
});

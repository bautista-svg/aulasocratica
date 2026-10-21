// Test fixtures: real files generated in memory (no binaries in the repo).
import { crc32 } from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** A text PDF with `pages` pages; `line(n)` is the sentence written on page n (1-based). */
export async function makePdf(pages: number, line: (n: number) => string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Capitulo ${n}`, { x: 50, y: 780, size: 16, font });
    page.drawText(line(n), { x: 50, y: 740, size: 11, font });
    page.drawText("Este texto de relleno hace que cada pagina tenga una capa de texto suficiente.", { x: 50, y: 720, size: 11, font });
  }
  return doc.save();
}

/** Minimal valid .docx (a ZIP with stored entries) with one paragraph per string. */
export function makeDocx(paragraphs: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
        .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
        .join("")}</w:body></w:document>`,
    ],
  ];
  const enc = new TextEncoder();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(enc.encode(name));
    const data = Buffer.from(enc.encode(content));
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt16LE(0, 10); // time
    lh.writeUInt16LE(0x21, 12); // date (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBytes, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBytes);
    offset += lh.length + nameBytes.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...local, centralBuf, end]));
}

/** FormData with one or more files under the `file` field. */
export function filesForm(files: { name: string; data: Uint8Array | string; type?: string }[], extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const f of files) {
    const bytes = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
    form.append("file", new Blob([new Uint8Array(bytes)], { type: f.type ?? "" }), f.name);
  }
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

// Genera archivos de prueba: PDF de 200 páginas, Word .docx, foto PNG/JPG, audio WAV, txt, archivos inválidos
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib.mjs";

const OUT = "C:/Users/gonib/Downloads/aulasocratica/docs/informes/auditoria-ui/scripts/archivos";
fs.mkdirSync(OUT, { recursive: true });

// 1) PDF de 200 páginas con texto distinto en cada una
async function pdf(pages, name) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Capitulo ${i}: El ciclo del agua y la presion atmosferica`, { x: 50, y: 790, size: 16, font, color: rgb(0, 0, 0.4) });
    const lines = [
      `Pagina ${i} de ${pages}. Marca unica PAGINA-${String(i).padStart(3, "0")}.`,
      "El agua hierve cuando su presion de vapor iguala a la presion del ambiente.",
      "En la montana la presion del aire es menor, por eso el agua hierve a menos de 100 grados.",
      "La evaporacion, la condensacion y la precipitacion forman el ciclo del agua.",
      `Dato de control de esta pagina: ${i * 7} litros por metro cuadrado.`,
    ];
    lines.forEach((t, k) => p.drawText(t, { x: 50, y: 740 - k * 22, size: 11, font }));
  }
  fs.writeFileSync(path.join(OUT, name), await doc.save());
}
await pdf(200, "libro-200-paginas.pdf");
await pdf(3, "apunte-3-paginas.pdf");

// PDF > 60 MB: PDF válido + relleno de comentarios al final
{
  const base = fs.readFileSync(path.join(OUT, "apunte-3-paginas.pdf"));
  const pad = Buffer.alloc(61 * 1024 * 1024, 0x25); // '%'
  fs.writeFileSync(path.join(OUT, "pesado-61MB.pdf"), Buffer.concat([base, Buffer.from("\n"), pad]));
}
// PDF corrupto
fs.writeFileSync(path.join(OUT, "corrupto.pdf"), Buffer.from("esto no es un pdf, es texto con extension pdf ".repeat(50)));
// Archivo vacío
fs.writeFileSync(path.join(OUT, "vacio.pdf"), Buffer.alloc(0));
// Archivo no soportado
fs.writeFileSync(path.join(OUT, "programa.exe"), Buffer.from("MZ" + "x".repeat(1000)));
fs.writeFileSync(path.join(OUT, "planilla.xlsx"), Buffer.from("PK fake xlsx"));

// 2) Word .docx mínimo válido
{
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paras = [
    "La Revolución de Mayo de 1810",
    "El 25 de mayo de 1810 se formó en Buenos Aires la Primera Junta de gobierno.",
    "Las causas incluyen la crisis de la monarquía española y las ideas de la Ilustración.",
    "Actividad: explicá con tus palabras por qué se formó la Primera Junta.",
    "MARCA-WORD-001",
  ].map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  fs.writeFileSync(path.join(OUT, "revolucion-mayo.docx"), await zip.generateAsync({ type: "nodebuffer" }));
}

// 3) Foto (PNG/JPG) de una "hoja" con texto, renderizada con el navegador
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.setContent(`<body style="margin:0;background:#f4efe1;font-family:Georgia;padding:60px"><h1>Fracciones equivalentes</h1><p style="font-size:28px">1/2 = 2/4 = 4/8</p><p style="font-size:24px">Dos fracciones son equivalentes si representan la misma parte de un entero.</p><p style="font-size:24px">Ejercicio: ¿Es 3/6 equivalente a 1/2? Justificá.</p><p style="font-size:20px">MARCA-FOTO-001</p></body>`);
  await page.screenshot({ path: path.join(OUT, "foto-fracciones.png") });
  await page.screenshot({ path: path.join(OUT, "foto-fracciones.jpg"), type: "jpeg", quality: 80 });
  await browser.close();
}

// 4) Audio WAV de 3 segundos (tono)
{
  const sr = 16000, secs = 3, n = sr * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000), 44 + i * 2);
  fs.writeFileSync(path.join(OUT, "audio-tono.wav"), buf);
}

// 5) Texto
fs.writeFileSync(path.join(OUT, "texto-fotosintesis.txt"), "La fotosintesis es el proceso por el cual las plantas transforman la luz en energia quimica.\nMARCA-TXT-001\n");

for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);

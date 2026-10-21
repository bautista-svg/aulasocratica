// Small PDF toolkit (PDFKit) shared by the student journey and report exports.
// Uses the built-in Helvetica/Times faces (WinAnsi), so text is sanitized to that charset.
import PDFDocument from "pdfkit";

export const COLORS = {
  ink: "#14295c",
  text: "#172036",
  text2: "#4b5470",
  text3: "#646c88",
  lilac: "#9b87e8",
  lilacInk: "#5b45b8",
  leaf: "#3f6b22",
  line: "#dde1ec",
  sunken: "#eef0f7",
};

/** Characters outside WinAnsi (emoji, CJK…) would render as garbage: replace them. */
export function pdfSafe(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/[^\n\t\x20-\x7E -ÿ]/g, "");
}

export class PdfWriter {
  doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;
  readonly left = 56;
  readonly width: number;

  constructor(meta: { title: string; subject?: string }) {
    this.doc = new PDFDocument({
      size: "A4",
      margins: { top: 64, bottom: 64, left: 56, right: 56 },
      bufferPages: true,
      info: { Title: pdfSafe(meta.title), Subject: pdfSafe(meta.subject ?? ""), Creator: "Aula Socrática", Producer: "Aula Socrática" },
      lang: "es-AR",
    });
    this.width = this.doc.page.width - 112;
    this.doc.on("data", (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve) => this.doc.on("end", () => resolve(Buffer.concat(this.chunks))));
  }

  brandHeader(subtitle: string) {
    const d = this.doc;
    d.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text("Aula Socrática", this.left, 32, { continued: true });
    d.font("Helvetica").fillColor(COLORS.text3).text(`  ·  ${pdfSafe(subtitle)}`);
    d.moveTo(this.left, 50).lineTo(this.left + this.width, 50).lineWidth(0.6).strokeColor(COLORS.line).stroke();
    d.y = 72;
  }

  title(text: string) {
    this.doc.font("Times-Bold").fontSize(22).fillColor(COLORS.ink).text(pdfSafe(text), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.3);
  }

  meta(lines: string[]) {
    this.doc.font("Helvetica").fontSize(10).fillColor(COLORS.text2);
    for (const l of lines) this.doc.text(pdfSafe(l), { width: this.width });
    this.doc.moveDown(0.8);
  }

  section(text: string) {
    this.ensureSpace(60);
    this.doc.moveDown(0.6);
    this.doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.lilacInk).text(pdfSafe(text).toUpperCase(), this.left, this.doc.y, {
      width: this.width,
      characterSpacing: 0.8,
    });
    this.doc.moveDown(0.35);
  }

  paragraph(text: string, opts: { color?: string; italic?: boolean; size?: number } = {}) {
    const t = pdfSafe(text).trim();
    if (!t) return;
    this.doc
      .font(opts.italic ? "Helvetica-Oblique" : "Helvetica")
      .fontSize(opts.size ?? 11)
      .fillColor(opts.color ?? COLORS.text)
      .text(t, this.left, this.doc.y, { width: this.width, lineGap: 2.5 });
    this.doc.moveDown(0.5);
  }

  /** A labelled block, e.g. "Alumno · 10:42" followed by the text. */
  labelled(label: string, text: string, opts: { color?: string } = {}) {
    this.ensureSpace(40);
    this.doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.text3).text(pdfSafe(label), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.15);
    this.paragraph(text, { color: opts.color });
  }

  /** A tutor question with the hanging lilac question mark. */
  question(text: string, label?: string) {
    this.ensureSpace(40);
    const y = this.doc.y;
    if (label) {
      this.doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.text3).text(pdfSafe(label), this.left + 18, y, { width: this.width - 18 });
      this.doc.moveDown(0.15);
    }
    const qy = this.doc.y;
    this.doc.font("Times-BoldItalic").fontSize(15).fillColor(COLORS.lilac).text("?", this.left, qy - 2, { lineBreak: false });
    this.doc
      .font("Times-Italic")
      .fontSize(12)
      .fillColor(COLORS.ink)
      .text(pdfSafe(text).trim(), this.left + 18, qy, { width: this.width - 18, lineGap: 2.5 });
    this.doc.moveDown(0.5);
  }

  bullet(text: string) {
    this.ensureSpace(24);
    this.doc.font("Helvetica").fontSize(11).fillColor(COLORS.text).text(`•  ${pdfSafe(text)}`, this.left + 6, this.doc.y, {
      width: this.width - 6,
      lineGap: 2,
    });
    this.doc.moveDown(0.25);
  }

  table(columns: string[], rows: (string | number)[][]) {
    const colW = this.width / columns.length;
    const drawRow = (cells: (string | number)[], bold: boolean) => {
      this.ensureSpace(22);
      const y = this.doc.y;
      let maxH = 0;
      cells.forEach((cell, i) => {
        const h = this.doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .heightOfString(pdfSafe(String(cell)), { width: colW - 8 });
        maxH = Math.max(maxH, h);
      });
      cells.forEach((cell, i) => {
        this.doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(bold ? COLORS.ink : COLORS.text)
          .text(pdfSafe(String(cell)), this.left + i * colW + 4, y + 4, { width: colW - 8 });
      });
      this.doc.y = y + maxH + 8;
      this.doc.moveTo(this.left, this.doc.y).lineTo(this.left + this.width, this.doc.y).lineWidth(0.4).strokeColor(COLORS.line).stroke();
    };
    drawRow(columns, true);
    for (const r of rows) drawRow(r, false);
    this.doc.moveDown(0.6);
  }

  ensureSpace(points: number) {
    if (this.doc.y + points > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage();
  }

  async finish(footer: string): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const bottom = this.doc.page.height - 40;
      this.doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(COLORS.text3)
        .text(`${pdfSafe(footer)}   ·   Página ${i + 1} de ${range.count}`, this.left, bottom, { width: this.width, align: "center", lineBreak: false });
    }
    this.doc.end();
    return this.done;
  }
}

/** Content-Disposition with a safe ASCII fallback and the UTF-8 name. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ]/g, "").trim() || "documento.pdf";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

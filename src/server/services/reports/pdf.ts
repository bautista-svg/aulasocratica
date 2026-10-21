// Real PDF of a report (PDFKit): title, scope, status, headline, observed-data tables and the
// teacher's narrative. Tables use weighted column widths and measure each row before drawing
// it, so long answers wrap inside their cell and never get cut at the page bottom.
import { COLORS, PdfWriter, pdfSafe } from "../../lib/pdf";
import { REPORT_KIND_LABELS, REPORT_SECTIONS, type ReportData, type ReportKind, type ReportStatus, type ReportTable } from "@shared/domain/reports";
import { fmtReportLongDate } from "./build";

export interface PdfReport {
  title: string;
  kind: ReportKind;
  status: ReportStatus;
  validatedAt: Date | null;
  scopeLabel: string;
  data: ReportData;
  narrative: Record<string, string>;
}

const CELL_MAX = 700;
const cellText = (v: string | number) => {
  const s = pdfSafe(String(v ?? ""));
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX - 3)}...` : s;
};

function subheading(w: PdfWriter, text: string) {
  w.ensureSpace(70);
  w.doc.moveDown(0.5);
  w.doc.font("Helvetica-Bold").fontSize(11.5).fillColor(COLORS.ink).text(pdfSafe(text), w.left, w.doc.y, { width: w.width });
  w.doc.moveDown(0.2);
}

function note(w: PdfWriter, text: string) {
  w.doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(COLORS.text3).text(pdfSafe(text), w.left, w.doc.y, { width: w.width });
  w.doc.moveDown(0.3);
}

/** Column weights from content length: text-heavy columns get more room. */
function weights(t: ReportTable): number[] {
  return t.columns.map((col, i) => {
    const lens = t.rows.map((r) => String(r[i] ?? "").length);
    const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    return Math.min(40, Math.max(7, col.length * 0.8, avg));
  });
}

function drawTable(w: PdfWriter, t: ReportTable) {
  const d = w.doc;
  const ws = weights(t);
  const total = ws.reduce((a, b) => a + b, 0);
  const widths = ws.map((x) => (x / total) * w.width);
  const pad = 4;
  const usable = d.page.height - d.page.margins.top - d.page.margins.bottom;

  const measure = (cells: string[], bold: boolean) => {
    d.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 8.5 : 9);
    return Math.max(...cells.map((c, i) => d.heightOfString(c || " ", { width: widths[i]! - pad * 2 }))) + pad * 2;
  };
  const bottom = () => d.page.height - d.page.margins.bottom;
  const drawRow = (cells: string[], bold: boolean, h: number) => {
    const y = d.y;
    if (bold) d.rect(w.left, y, w.width, h).fill(COLORS.sunken);
    let x = w.left;
    cells.forEach((c, i) => {
      d.font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 8.5 : 9)
        .fillColor(bold ? COLORS.ink : COLORS.text)
        .text(c, x + pad, y + pad, { width: widths[i]! - pad * 2, height: h - pad, ellipsis: true });
      x += widths[i]!;
    });
    d.y = y + h;
    d.moveTo(w.left, d.y)
      .lineTo(w.left + w.width, d.y)
      .lineWidth(0.4)
      .strokeColor(COLORS.line)
      .stroke();
  };

  const header = t.columns.map(cellText);
  const headerH = Math.min(measure(header, true), usable / 4);
  const rows = t.rows.map((r) => {
    const cells = t.columns.map((_, i) => cellText(r[i] ?? ""));
    return { cells, h: Math.min(measure(cells, false), usable - headerH - 4) };
  });
  // Header and first row stay together; the header repeats when the table continues on a new page.
  if (d.y + headerH + (rows[0]?.h ?? 0) > bottom()) d.addPage();
  drawRow(header, true, headerH);
  for (const row of rows) {
    if (d.y + row.h > bottom()) {
      d.addPage();
      drawRow(header, true, headerH);
    }
    drawRow(row.cells, false, row.h);
  }
  d.x = w.left;
  d.moveDown(0.8);
}

export async function reportPdf(r: PdfReport): Promise<Buffer> {
  const kindLabel = REPORT_KIND_LABELS[r.kind];
  const statusLine =
    r.status === "validated"
      ? `Validado por el docente${r.validatedAt ? ` el ${fmtReportLongDate(r.validatedAt)}` : ""}`
      : "Borrador: todavía no fue validado por el docente";
  const w = new PdfWriter({ title: r.title, subject: `Informe ${kindLabel.toLowerCase()}` });
  w.brandHeader(`Informe ${kindLabel.toLowerCase()} · ${r.status === "validated" ? "Validado" : "Borrador"}`);
  w.title(r.title);
  w.meta(
    [r.scopeLabel, `Estado: ${statusLine}`, r.data.generatedAt ? `Datos observados al ${fmtReportLongDate(r.data.generatedAt)}` : ""].filter(Boolean),
  );

  w.section("Datos observados");
  w.paragraph(
    "Datos registrados por la plataforma durante las actividades. Las rúbricas y las interpretaciones solo aparecen si el docente las confirmó.",
    {
      color: COLORS.text2,
      size: 9.5,
    },
  );
  if (r.data.headline.length) {
    drawTable(w, { title: "", columns: r.data.headline.map((h) => h.label), rows: [r.data.headline.map((h) => h.value)] });
  }
  for (const t of r.data.tables) {
    subheading(w, t.title);
    if (t.note) note(w, t.note);
    if (t.rows.length === 0) w.paragraph("Sin datos todavía.", { color: COLORS.text3, italic: true, size: 10 });
    else drawTable(w, t);
  }

  w.section("Valoración del docente");
  if (r.status !== "validated") {
    w.paragraph("Borrador: el docente todavía no validó este texto.", { color: COLORS.text3, italic: true, size: 9.5 });
  }
  for (const s of REPORT_SECTIONS[r.kind]) {
    const text = (r.narrative[s.key] ?? "").trim();
    w.labelled(s.label, text || "(Sin completar)", { color: text ? COLORS.text : COLORS.text3 });
  }
  return w.finish(`${r.title} · ${r.status === "validated" ? "Validado" : "Borrador"}`);
}

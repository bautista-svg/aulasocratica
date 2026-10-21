import { describe, expect, it } from "vitest";
import {
  countHelp,
  excerpt,
  formatMinutes,
  median,
  missingSections,
  readNarrative,
  readReportData,
  reportFileName,
  reportToCsv,
  totalHelp,
  type ReportData,
} from "./reports";

const data: ReportData = {
  generatedAt: "2026-10-20T12:00:00.000Z",
  subtitle: "5.º B · datos al 20 de octubre de 2026",
  headline: [
    { label: "Alumnos", value: 20 },
    { label: "Finalización", value: "50%" },
  ],
  tables: [
    { title: "Participación", columns: ["Actividad", "Participantes"], rows: [["Fracciones; parte 1", 12]], note: "Solo publicadas." },
    { title: "Vacía", columns: ["A", "B"], rows: [] },
  ],
};

describe("reportToCsv", () => {
  const csv = reportToCsv({ title: "Informe grupal — 5.º B", kind: "group", status: "draft" }, data, {
    shared_difficulties: 'Dijo "no entiendo"\nvarias veces',
    evidence: '=HYPERLINK("http://x")',
    recommendations: "-3 puntos no; @usuario",
  });

  it("starts with a BOM and uses ';' as separator with CRLF lines", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("Alumnos;20\r\n");
    expect(csv).toContain("Actividad;Participantes\r\n");
    expect(csv).not.toContain("Alumnos,20");
  });

  it("quotes cells with separators, quotes or line breaks", () => {
    expect(csv).toContain('"Fracciones; parte 1";12');
    expect(csv).toContain('Dificultades compartidas;"Dijo ""no entiendo""\nvarias veces"');
  });

  it("neutralizes spreadsheet formulas but keeps plain numbers", () => {
    expect(csv).toContain(`Evidencias de aprendizaje;"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain('Recomendaciones para próximas clases;"\'-3 puntos no; @usuario"');
    expect(reportToCsv({ title: "-5", kind: "overview", status: "draft" }, { ...data, tables: [] }, {})).toContain("﻿-5\r\n");
  });

  it("marks empty tables and the report status", () => {
    expect(csv).toContain("Vacía\r\nA;B\r\nSin datos todavía");
    expect(csv).toContain("Estado;Borrador (sin validar)");
    expect(csv).toContain("Tipo;Grupal");
  });
});

describe("narrative", () => {
  it("keeps only the kind's sections and caps their length", () => {
    const n = readNarrative("overview", { participation: "x".repeat(6000), other: "y", next_steps: 3 });
    expect(Object.keys(n)).toEqual(["participation", "shared_difficulties", "next_steps"]);
    expect(n.participation).toHaveLength(5000);
    expect(n.next_steps).toBe("");
  });

  it("lists the sections that still need text (whitespace does not count)", () => {
    const missing = missingSections("individual", { evolution: "Mejoró", difficulties: "   ", recommendations: "" });
    expect(missing.map((s) => s.key)).toEqual(["difficulties", "recommendations"]);
  });
});

describe("helpers", () => {
  it("counts help requests from single or aggregated rows", () => {
    const c = countHelp([
      { eventType: "hint_requested" },
      { eventType: "hint_requested", n: 3 },
      { eventType: "message_sent" },
      { eventType: "review_requested" },
    ]);
    expect(c).toEqual({ hint_requested: 4, clarification_requested: 0, example_requested: 0, review_requested: 1 });
    expect(totalHelp(c)).toBe(5);
  });

  it("formats durations and medians", () => {
    expect(formatMinutes(0.4)).toBe("menos de 1 min");
    expect(formatMinutes(12.4)).toBe("12 min");
    expect(formatMinutes(65)).toBe("1 h 05 min");
    expect(formatMinutes(null)).toBe("—");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("reads stored snapshots defensively", () => {
    expect(readReportData(null)).toEqual({ generatedAt: "", subtitle: "", headline: [], tables: [] });
    const r = readReportData({ headline: [{ label: "A", value: { x: 1 } }, null], tables: [{ title: "T", columns: ["a"], rows: [[1, null], "x"] }] });
    expect(r.headline).toEqual([{ label: "A", value: "[object Object]" }]);
    expect(r.tables[0]!.rows).toEqual([[1, ""]]);
  });

  it("builds safe file names and short excerpts", () => {
    expect(reportFileName('Informe grupal — 5.º B: "final"', "csv")).toBe("Informe grupal - 5.º B final.csv");
    expect(reportFileName("   ", "pdf")).toBe("Informe.pdf");
    expect(excerpt("  uno\n\n dos  ", 300)).toBe("uno dos");
    expect(excerpt("abcdefghij", 5)).toBe("abcd…");
  });
});

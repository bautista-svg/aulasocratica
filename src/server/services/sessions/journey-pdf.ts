// PDF with a student's whole journey in one activity: what they answered first, the full
// conversation (tutor questions highlighted, help requests labelled), the final answer,
// the reflection, the teacher-confirmed evaluation and the observed integrity signals.
import { PdfWriter, attachmentHeader } from "../../lib/pdf";
import { EVENT_LABELS, STUDENT_INTENTS } from "@shared/domain/pedagogy";
import { XRAY_MOMENTS, tutorQuestion } from "@shared/domain/thinking-xray";
import { formatDuration } from "@shared/domain/live-monitor";
import type { SessionDetail } from "@shared/contracts/sessions";
import { ownWords } from "./corpus";

const TZ = "America/Argentina/Buenos_Aires";
const dateTime = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const timeOnly = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");
const hm = (iso: string) => timeOnly.format(new Date(iso));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The footer of the shared writer is drawn below the bottom margin; without this PDFKit adds a blank page per footer. */
class JourneyWriter extends PdfWriter {
  override async finish(footer: string): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc.page.margins = { ...this.doc.page.margins, bottom: 0 };
    }
    return super.finish(footer);
  }
}

function statusLine(d: SessionDetail): string {
  if (d.session.status === "completed") {
    return d.session.endedByTeacher ? "Estado: terminado por el docente" : "Estado: terminado por el alumno";
  }
  return "Estado: en curso (todavía puede seguir trabajando)";
}

/** Plain text of a tutor turn (markdown marks removed) split around its question. */
export function splitTutorTurn(content: string): { before: string; question: string | null; after: string } {
  const plain = content.replace(/[*_`#>]/g, "").replace(/[ \t]+/g, " ").trim();
  const q = tutorQuestion(content);
  if (!q) return { before: plain, question: null, after: "" };
  const pattern = new RegExp(q.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const m = pattern.exec(plain);
  if (!m) return { before: plain, question: q, after: "" };
  return { before: plain.slice(0, m.index).trim(), question: m[0].replace(/\s+/g, " ").trim(), after: plain.slice(m.index + m[0].length).trim() };
}

export function journeyFileName(d: SessionDetail): string {
  return `Recorrido - ${d.student.fullName} - ${d.activity.title}.pdf`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ");
}

export function journeyDisposition(d: SessionDetail): string {
  return attachmentHeader(journeyFileName(d));
}

export async function buildJourneyPdf(d: SessionDetail): Promise<Buffer> {
  const w = new JourneyWriter({ title: `Recorrido de ${d.student.fullName}`, subject: d.activity.title });
  w.brandHeader("Recorrido del alumno");
  w.title(d.student.fullName);
  w.meta([
    `Actividad: ${d.activity.title}`,
    `Aula: ${d.classroom.label}`,
    `Empezó: ${fmt(d.session.startedAt)}   ·   Última actividad: ${fmt(d.session.lastActivityAt)}`,
    d.session.completedAt ? `Terminó: ${fmt(d.session.completedAt)}` : "Todavía no terminó.",
    statusLine(d),
  ]);

  w.section("Consigna");
  if (d.activity.instructions.trim()) w.paragraph(d.activity.instructions);
  else w.paragraph("La actividad no tiene consigna escrita.", { italic: true, color: "#646c88" });

  if (d.activity.requireInitialAnswer || d.session.initialAnswer?.trim()) {
    w.section("Respuesta inicial");
    if (d.session.initialAnswer?.trim()) w.paragraph(d.session.initialAnswer);
    else w.paragraph("Todavía no la escribió.", { italic: true, color: "#646c88" });
  }

  w.section("Conversación con el tutor");
  const finished = d.messages.filter((m) => !m.isPartial);
  if (finished.length === 0) w.paragraph("Todavía no hay mensajes.", { italic: true, color: "#646c88" });
  for (const m of finished) {
    const voice = m.inputMode === "voice" ? " (por voz)" : "";
    if (m.role === "assistant") {
      const turn = splitTutorTurn(m.content);
      const label = `Tutor · ${hm(m.createdAt)}`;
      if (turn.before) {
        w.labelled(label, turn.before);
        if (turn.question) w.question(turn.question);
      } else if (turn.question) {
        w.question(turn.question, label);
      }
      if (turn.after) w.paragraph(turn.after);
      continue;
    }
    const intent = m.intent && m.intent in STUDENT_INTENTS ? STUDENT_INTENTS[m.intent as keyof typeof STUDENT_INTENTS] : null;
    if (intent) {
      const label = `${EVENT_LABELS[intent.event] ?? intent.label} · ${hm(m.createdAt)}${voice}`;
      const own = ownWords(m);
      w.labelled(label, own || `«${intent.label}»`, { color: own ? undefined : "#4b5470" });
    } else {
      w.labelled(`${d.student.fullName} · ${hm(m.createdAt)}${voice}`, m.content);
    }
  }
  if (d.messages.some((m) => m.isPartial)) {
    w.paragraph("El tutor estaba escribiendo una respuesta cuando se generó este PDF.", { italic: true, color: "#646c88", size: 10 });
  }

  w.section("Respuesta final");
  if (d.session.finalAnswer?.trim()) w.paragraph(d.session.finalAnswer);
  else
    w.paragraph(d.session.endedByTeacher ? "No la escribió: el docente terminó la actividad antes." : "Todavía no la escribió.", {
      italic: true,
      color: "#646c88",
    });

  if (d.session.reflection.length) {
    w.section("Reflexión");
    for (const r of d.session.reflection) w.labelled(r.question || "Pregunta", r.answer);
  }

  const ev = d.rubric;
  if (ev.status === "confirmed" && ev.rubric.length) {
    w.section("Evaluación con rúbrica (confirmada por el docente)");
    w.table(
      ["Criterio", "Nivel"],
      ev.rubric.map((c) => {
        const li = ev.teacherLevels[c.id];
        return [c.name, li !== undefined ? (c.levels[li]?.label ?? "—") : "Sin nivel"];
      }),
    );
    if (ev.comment.trim()) w.labelled("Comentario del docente", ev.comment);
  }

  const validated = d.xray.items.filter((i) => i.status === "validated");
  if (validated.length) {
    w.section("Radiografía del pensamiento (validada por el docente)");
    for (const i of validated) {
      const moment = XRAY_MOMENTS[i.moment];
      w.labelled(`${moment.title} · ${moment.categories[i.category] ?? i.category}`, i.interpretation);
      w.paragraph(`«${i.evidence}»`, { italic: true, color: "#4b5470", size: 10 });
    }
  }

  w.section("Señales observadas en el navegador");
  if (d.signals.summary.length) {
    for (const s of d.signals.summary) w.bullet(s);
    w.paragraph("Son datos registrados por el navegador, no conclusiones: conviene charlarlo con el alumno.", { size: 9.5, color: "#646c88" });
  } else {
    w.paragraph("No se registró texto pegado desde afuera ni salidas de la actividad.", { color: "#4b5470" });
  }

  const helpTotal = d.events.filter((e) => ["hint_requested", "clarification_requested", "example_requested"].includes(e.eventType)).length;
  const workSpan = d.session.completedAt
    ? new Date(d.session.completedAt).getTime() - new Date(d.session.startedAt).getTime()
    : new Date(d.session.lastSignalAt).getTime() - new Date(d.session.startedAt).getTime();
  w.paragraph(
    `${plural(finished.filter((m) => m.role === "user").length, "mensaje", "mensajes")} del alumno · ${plural(helpTotal, "pedido", "pedidos")} de ayuda · ${formatDuration(Math.max(0, workSpan))} entre el inicio y su última acción.`,
    { size: 9.5, color: "#646c88" },
  );

  return w.finish(`${d.student.fullName} · ${d.activity.title}`);
}

// "Conversación" tab: the full transcript, with the tutor's reply that is still being
// written (streaming) and the observed events (pasted text, leaving the app…) in between.
import { Mic } from "lucide-react";
import { cn } from "@client/lib/cn";
import { fmtTime, fmtDate } from "@client/lib/format";
import { EVENT_LABELS, STUDENT_INTENTS } from "@shared/domain/pedagogy";
import { formatAway } from "@shared/domain/alerts";
import { tutorQuestion } from "@shared/domain/thinking-xray";
import type { SessionDetail, SessionEvent, SessionMessage } from "@shared/contracts/sessions";

/** Events shown as small lines inside the transcript (the rest are already visible as messages). */
const TIMELINE_EVENTS = new Set([
  "session_entered",
  "initial_answer_saved",
  "closing_started",
  "final_answer_saved",
  "reflection_submitted",
  "deliverable_uploaded",
  "deliverable_removed",
  "activity_completed",
  "ended_by_teacher",
  "pasted_text",
  "left_app",
]);

export function eventText(e: SessionEvent): string {
  const base = EVENT_LABELS[e.eventType] ?? e.eventType;
  // How the student got in (F-07): helps spot someone who entered with a classmate's name.
  if (e.eventType === "session_entered" && e.details.resumed === true) return "Siguió desde otro dispositivo con su código";
  if (e.eventType === "session_entered" && e.details.fromRoster === true) return "Entró con un nombre de la lista del aula";
  if (e.eventType === "pasted_text" && typeof e.details.chars === "number") return `${base} (${e.details.chars} caracteres)`;
  if (e.eventType === "deliverable_uploaded" && e.details.replaced === true) return "Cambió su archivo de entrega";
  if (e.eventType === "left_app" && typeof e.details.away_ms === "number") return `${base} durante ${formatAway(e.details.away_ms)}`;
  return base;
}

type Item = { kind: "message"; m: SessionMessage } | { kind: "event"; e: SessionEvent };

/** Matches the question inside the original text regardless of line breaks/spaces. */
export function questionPattern(q: string): RegExp {
  const words = q.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(words.join("\\s+"));
}

/** Tutor turn with its (last) question highlighted, keeping the line breaks of the rest. */
function TutorText({ content }: { content: string }) {
  const plain = content.replace(/[*_`#>]/g, "").replace(/[ \t]+/g, " ").trim();
  const q = tutorQuestion(content);
  const m = q ? questionPattern(q).exec(plain) : null;
  if (!q || !m) return <p className="whitespace-pre-wrap">{plain}</p>;
  const before = plain.slice(0, m.index).trim();
  const after = plain.slice(m.index + m[0].length).trim();
  return (
    <>
      {before ? <p className="whitespace-pre-wrap">{before}</p> : null}
      <p className={cn("q-hang text-[16px] leading-7", before && "mt-2")}>{q}</p>
      {after ? <p className="mt-2 whitespace-pre-wrap">{after}</p> : null}
    </>
  );
}

export function ConversationTab({ detail, live }: { detail: SessionDetail; live: boolean }) {
  const items: Item[] = [
    ...detail.messages.map((m) => ({ kind: "message" as const, m })),
    ...detail.events.filter((e) => TIMELINE_EVENTS.has(e.eventType)).map((e) => ({ kind: "event" as const, e })),
  ].sort((a, b) => {
    const ta = a.kind === "message" ? a.m.createdAt : a.e.createdAt;
    const tb = b.kind === "message" ? b.m.createdAt : b.e.createdAt;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const hasMessages = detail.messages.length > 0;
  const days = items.map((it) => fmtDate(it.kind === "message" ? it.m.createdAt : it.e.createdAt));
  const multiDay = new Set(days).size > 1;

  return (
    <section aria-labelledby="conv-title" className="rounded-lg border border-line bg-surface p-4 shadow-1 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="conv-title" className="font-display text-lg font-semibold text-ink">
          Conversación completa
        </h2>
        {live ? (
          <p className="flex items-center gap-2 text-sm text-text-2">
            <span className="size-2 animate-pulse-dot rounded-full bg-leaf-bright" aria-hidden="true" />
            El alumno está trabajando: lo nuevo aparece solo.
          </p>
        ) : null}
      </div>
      {!hasMessages ? (
        <p className="mt-4 text-[15px] text-text-2">Todavía no hay mensajes con el tutor.</p>
      ) : null}
      <ol className="mt-5 space-y-3" aria-live={live ? "polite" : "off"} aria-relevant="additions">
        {items.map((it, i) => {
          const at = it.kind === "message" ? it.m.createdAt : it.e.createdAt;
          const dayLine = multiDay && days[i] !== days[i - 1] ? days[i] : null;
          return (
            <li key={it.kind === "message" ? it.m.id : it.e.id}>
              {dayLine ? <p className="my-2 text-center text-xs font-semibold text-text-3">{dayLine}</p> : null}
              {it.kind === "event" ? (
                <p className={cn("text-center text-xs", ["pasted_text", "left_app"].includes(it.e.eventType) ? "font-semibold text-amber" : "text-text-3")}>
                  {fmtTime(at)} · {eventText(it.e)}
                </p>
              ) : (
                <MessageBubble m={it.m} studentName={detail.student.fullName} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MessageBubble({ m, studentName }: { m: SessionMessage; studentName: string }) {
  const tutor = m.role === "assistant";
  const intent = !tutor && m.intent && m.intent in STUDENT_INTENTS ? STUDENT_INTENTS[m.intent as keyof typeof STUDENT_INTENTS] : null;
  return (
    <div className={cn("flex", tutor ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[92%] rounded-lg px-4 py-3 text-[15px] leading-6 sm:max-w-[80%]",
          tutor ? "border border-line bg-paper text-text" : "bg-ink-soft text-text",
          m.isPartial && "border-dashed",
        )}
      >
        {/* text-2: the lighter text-3 is below 4.5:1 on the student's ink-soft bubble (D14). */}
        <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs font-semibold text-text-2">
          <span>{tutor ? "Tutor" : studentName}</span>
          <span className="font-normal">{fmtTime(m.createdAt)}</span>
          {m.inputMode === "voice" ? (
            <span className="inline-flex items-center gap-1 font-normal">
              <Mic className="size-3" aria-hidden="true" /> por voz
            </span>
          ) : null}
          {intent ? <span className="rounded-full bg-surface px-2 py-0.5 font-semibold text-lilac-ink">{EVENT_LABELS[intent.event] ?? intent.label}</span> : null}
        </p>
        {tutor ? <TutorText content={m.content} /> : <p className="whitespace-pre-wrap">{m.content}</p>}
        {m.isPartial ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-3" role="status">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-lilac-ink" aria-hidden="true" />
            El tutor está escribiendo…
          </p>
        ) : null}
      </div>
    </div>
  );
}

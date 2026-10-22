// "Recorrido" tab: the observed path of the student's thinking, as a vertical thread:
// initial answer (if any) → tutor question → what the student answered (or the help asked for) →
// next question … → final answer → reflection. Everything comes from what was recorded.
import { useState, type ReactNode } from "react";
import { Mic } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Button } from "@client/components/ui/button";
import { fmtTime } from "@client/lib/format";
import { EVENT_LABELS, STUDENT_INTENTS, type StudentIntent } from "@shared/domain/pedagogy";
import { intentMessages } from "@shared/domain/language";
import { HELP_INTENTS, REFORMULATION_INTENTS, studentMessageCounts } from "@shared/domain/live-monitor";
import { tutorQuestion } from "@shared/domain/thinking-xray";
import type { SessionDetail } from "@shared/contracts/sessions";

const COLLAPSE_AFTER = 20;

type Step =
  | { kind: "initial"; text: string | null; at: string | null }
  | { kind: "question"; text: string; at: string }
  | { kind: "reply"; text: string; at: string; voice: boolean }
  | { kind: "help"; text: string; at: string; label: string; voice: boolean }
  | { kind: "reformulation"; text: string; at: string; label: string; voice: boolean }
  | { kind: "final"; text: string | null; at: string | null }
  | { kind: "reflection"; items: { question: string; answer: string }[] };

const MIDDLE = new Set<Step["kind"]>(["question", "reply", "help", "reformulation"]);

function eventAt(d: SessionDetail, type: string): string | null {
  return d.events.find((e) => e.eventType === type)?.createdAt ?? null;
}

const isHelp = (intent: string | null) => Boolean(intent && (HELP_INTENTS as readonly string[]).includes(intent));
const isReformulation = (intent: string | null) => Boolean(intent && (REFORMULATION_INTENTS as readonly string[]).includes(intent));

export function buildSteps(d: SessionDetail): Step[] {
  const steps: Step[] = [];
  if (d.activity.requireInitialAnswer || d.session.initialAnswer) {
    steps.push({ kind: "initial", text: d.session.initialAnswer, at: eventAt(d, "initial_answer_saved") });
  }
  for (const m of d.messages) {
    if (m.isPartial) continue;
    if (m.role === "assistant") {
      const q = tutorQuestion(m.content);
      if (q) steps.push({ kind: "question", text: q, at: m.createdAt });
      continue;
    }
    const voice = m.inputMode === "voice";
    const intent = m.intent && m.intent in STUDENT_INTENTS ? STUDENT_INTENTS[m.intent as keyof typeof STUDENT_INTENTS] : null;
    if (intent && isHelp(m.intent)) {
      steps.push({ kind: "help", text: intent.label, at: m.createdAt, label: EVENT_LABELS[intent.event] ?? intent.label, voice });
    } else if (intent && isReformulation(m.intent)) {
      const prefix = intentMessages(m.intent as StudentIntent).find((msg) => m.content.startsWith(msg));
      const text = prefix ? m.content.slice(prefix.length).trim() : m.content;
      steps.push({ kind: "reformulation", text: text || m.content, at: m.createdAt, label: EVENT_LABELS[intent.event] ?? intent.label, voice });
    } else {
      // What the student wrote (or dictated) in their own words, between two tutor questions.
      steps.push({ kind: "reply", text: m.content, at: m.createdAt, voice });
    }
  }
  if (d.activity.askFinalAnswer || d.session.finalAnswer) steps.push({ kind: "final", text: d.session.finalAnswer, at: eventAt(d, "final_answer_saved") });
  if (d.session.reflection.length) steps.push({ kind: "reflection", items: d.session.reflection });
  return steps;
}

function Node({
  tone,
  label,
  at,
  voice,
  compact,
  children,
}: {
  tone: "neutral" | "lilac" | "ink" | "leaf" | "amber";
  label: string;
  at?: string | null;
  voice?: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const dot = { neutral: "bg-line-strong", lilac: "bg-lilac", ink: "bg-ink", leaf: "bg-leaf-bright", amber: "bg-amber" }[tone];
  return (
    <li className={cn("relative pl-10 last:pb-0", compact ? "pb-4" : "pb-6")}>
      <span className={cn("absolute top-1 left-[5px] size-3.5 rounded-full border-2 border-surface ring-1 ring-line", dot)} aria-hidden="true" />
      <p className="text-xs font-semibold tracking-wide text-text-2 uppercase">
        {label}
        {at ? <span className="ml-2 font-normal tracking-normal normal-case">{fmtTime(at)}</span> : null}
        {voice ? (
          <span className="ml-2 inline-flex items-center gap-1 font-normal tracking-normal normal-case">
            <Mic className="size-3" aria-hidden="true" />
            por voz
          </span>
        ) : null}
      </p>
      <div className="mt-1">{children}</div>
    </li>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-[15px] text-text-2 italic">{children}</p>;

export function RecorridoTab({ detail }: { detail: SessionDetail }) {
  const steps = buildSteps(detail);
  const [expanded, setExpanded] = useState(false);
  const middleCount = steps.filter((s) => MIDDLE.has(s.kind)).length;
  const questions = steps.filter((s) => s.kind === "question").length;
  const counts = studentMessageCounts(detail.messages);
  const hints = detail.messages.filter((m) => m.role === "user" && !m.isPartial && m.intent === "hint").length;
  // Long conversations: show the first and last steps of the conversation and a button for the rest.
  const keepHead = Math.ceil(COLLAPSE_AFTER / 2);
  const keepTail = COLLAPSE_AFTER - keepHead;
  const collapsed = !expanded && middleCount > COLLAPSE_AFTER;
  const hiddenCount = collapsed ? middleCount - COLLAPSE_AFTER : 0;
  let middleIndex = -1;
  const visible: (Step | "more")[] = [];
  for (const s of steps) {
    if (MIDDLE.has(s.kind)) {
      middleIndex++;
      if (collapsed && middleIndex >= keepHead && middleIndex < middleCount - keepTail) {
        if (middleIndex === keepHead) visible.push("more");
        continue;
      }
    }
    visible.push(s);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <section aria-labelledby="recorrido-title" className="rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6">
        <h2 id="recorrido-title" className="font-display text-lg font-semibold text-ink">
          Recorrido del pensamiento
        </h2>
        <p className="mt-1 text-sm text-text-2">Lo que pensó y escribió, en el orden en que pasó: cada pregunta del tutor y lo que respondió.</p>
        <ol className="thread mt-5">
          {visible.map((s, i) => {
            if (s === "more") {
              return (
                <li key="more" className="relative pb-6 pl-10">
                  <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
                    Mostrar {hiddenCount} pasos más
                  </Button>
                </li>
              );
            }
            switch (s.kind) {
              case "initial":
                return (
                  <Node key={i} tone="neutral" label="Respuesta inicial" at={s.at}>
                    {s.text ? <p className="text-[15px] leading-7 whitespace-pre-wrap text-text">{s.text}</p> : <Muted>Todavía no la escribió.</Muted>}
                  </Node>
                );
              case "question":
                return (
                  <Node key={i} tone="lilac" label="Pregunta del tutor" at={s.at}>
                    <p className="q-hang text-[17px] leading-7">{s.text}</p>
                  </Node>
                );
              case "reply":
                return (
                  <Node key={i} tone="ink" label={`Respondió ${detail.student.fullName.split(/\s+/)[0] ?? ""}`.trim()} at={s.at} voice={s.voice}>
                    <p className="text-[15px] leading-7 whitespace-pre-wrap text-text">{s.text}</p>
                  </Node>
                );
              case "help":
                return (
                  <Node key={i} tone="amber" label={s.label} at={s.at} voice={s.voice} compact>
                    <p className="text-sm text-text-2">Tocó «{s.text}»</p>
                  </Node>
                );
              case "reformulation":
                return (
                  <Node key={i} tone="ink" label={s.label} at={s.at} voice={s.voice}>
                    <p className="text-[15px] leading-7 whitespace-pre-wrap text-text">{s.text}</p>
                  </Node>
                );
              case "final":
                return (
                  <Node key={i} tone="leaf" label={detail.session.finalAnswers.length > 1 ? "Respuestas finales" : "Respuesta final"} at={s.at}>
                    {detail.session.finalAnswers.length > 1 ? (
                      <ol className="space-y-3">
                        {detail.session.finalAnswers.map((a, j) => (
                          <li key={j}>
                            <p className="text-sm font-semibold text-text">
                              Consigna {j + 1}
                              {detail.activity.consignas[j] ? (
                                <span className="ml-1.5 font-normal text-text-3">· {detail.activity.consignas[j]!.slice(0, 90)}{detail.activity.consignas[j]!.length > 90 ? "…" : ""}</span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-[15px] leading-7 whitespace-pre-wrap text-text">{a}</p>
                          </li>
                        ))}
                      </ol>
                    ) : s.text ? (
                      <p className="text-[15px] leading-7 whitespace-pre-wrap text-text">{s.text}</p>
                    ) : (
                      <Muted>{detail.session.endedByTeacher ? "No la escribió: terminaste su trabajo antes." : "Todavía no la escribió."}</Muted>
                    )}
                  </Node>
                );
              case "reflection":
                return (
                  <Node key={i} tone="leaf" label="Reflexión">
                    <dl className="space-y-3">
                      {s.items.map((r, j) => (
                        <div key={j}>
                          <dt className="text-sm font-semibold text-text">{r.question}</dt>
                          <dd className="mt-0.5 text-[15px] leading-7 whitespace-pre-wrap text-text-2">{r.answer}</dd>
                        </div>
                      ))}
                    </dl>
                  </Node>
                );
            }
          })}
        </ol>
      </section>
      <div className="space-y-4">
        <section aria-labelledby="recorrido-numbers" className="rounded-lg border border-line bg-surface p-4 shadow-1">
          <h3 id="recorrido-numbers" className="text-sm font-semibold text-text">
            En números
          </h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Preguntas del tutor" value={questions} />
            <Row label="Mensajes escritos" value={counts.written} />
            <Row label="Reformulaciones" value={counts.reformulations} />
            <Row label="Pedidos de ayuda" value={counts.help} />
            <Row label="Pistas pedidas" value={hints} />
          </dl>
        </section>
        <p className="text-xs leading-5 text-text-2">
          «Pregunta del tutor» es la última pregunta de cada mensaje del tutor. «Mensajes escritos» son los que el alumno escribió o dictó sin usar un botón
          (el mismo número que en En vivo y en el PDF). Las reformulaciones son los mensajes que envió con «Quiero revisar mi respuesta», «Tengo otra idea» o
          «Quiero explicar lo que aprendí»; los pedidos de ayuda, «Necesito una pista», «No entendí» y «¿Podés darme un ejemplo?». La conversación completa está
          en la pestaña Conversación.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-2">{label}</dt>
      <dd className="tabular font-semibold text-text">{value}</dd>
    </div>
  );
}

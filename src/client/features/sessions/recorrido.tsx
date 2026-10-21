// "Recorrido" tab: the observed path of the student's thinking, as a vertical thread:
// initial answer (if any) → tutor questions and reformulations, in order → final answer → reflection.
import { useState, type ReactNode } from "react";
import { cn } from "@client/lib/cn";
import { Button } from "@client/components/ui/button";
import { fmtTime } from "@client/lib/format";
import { EVENT_LABELS, STUDENT_INTENTS } from "@shared/domain/pedagogy";
import { tutorQuestion } from "@shared/domain/thinking-xray";
import type { SessionDetail } from "@shared/contracts/sessions";

const REFORMULATION_INTENTS = new Set(["review", "other_idea", "explain"]);
const COLLAPSE_AFTER = 14;

type Step =
  | { kind: "initial"; text: string | null; at: string | null }
  | { kind: "question"; text: string; at: string }
  | { kind: "reformulation"; text: string; at: string; label: string }
  | { kind: "final"; text: string | null; at: string | null }
  | { kind: "reflection"; items: { question: string; answer: string }[] };

function eventAt(d: SessionDetail, type: string): string | null {
  return d.events.find((e) => e.eventType === type)?.createdAt ?? null;
}

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
    } else if (m.intent && REFORMULATION_INTENTS.has(m.intent)) {
      const intent = STUDENT_INTENTS[m.intent as keyof typeof STUDENT_INTENTS];
      const text = m.content.startsWith(intent.message) ? m.content.slice(intent.message.length).trim() : m.content;
      steps.push({ kind: "reformulation", text: text || m.content, at: m.createdAt, label: EVENT_LABELS[intent.event] ?? intent.label });
    }
  }
  steps.push({ kind: "final", text: d.session.finalAnswer, at: eventAt(d, "final_answer_saved") });
  if (d.session.reflection.length) steps.push({ kind: "reflection", items: d.session.reflection });
  return steps;
}

function Node({ tone, label, at, children }: { tone: "neutral" | "lilac" | "ink" | "leaf"; label: string; at?: string | null; children: ReactNode }) {
  const dot = { neutral: "bg-line-strong", lilac: "bg-lilac", ink: "bg-ink", leaf: "bg-leaf-bright" }[tone];
  return (
    <li className="relative pb-6 pl-10 last:pb-0">
      <span className={cn("absolute top-1 left-[5px] size-3.5 rounded-full border-2 border-surface ring-1 ring-line", dot)} aria-hidden="true" />
      <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">
        {label}
        {at ? <span className="ml-2 font-normal tracking-normal normal-case">{fmtTime(at)}</span> : null}
      </p>
      <div className="mt-1">{children}</div>
    </li>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="text-[15px] text-text-3 italic">{children}</p>;

export function RecorridoTab({ detail }: { detail: SessionDetail }) {
  const steps = buildSteps(detail);
  const [expanded, setExpanded] = useState(false);
  const middleCount = steps.filter((s) => s.kind === "question" || s.kind === "reformulation").length;
  const questions = steps.filter((s) => s.kind === "question").length;
  const reformulations = middleCount - questions;
  // Long conversations: show the first and last steps of the conversation and a button for the rest.
  const keepHead = Math.ceil(COLLAPSE_AFTER / 2);
  const keepTail = COLLAPSE_AFTER - keepHead;
  const collapsed = !expanded && middleCount > COLLAPSE_AFTER;
  const hiddenCount = collapsed ? middleCount - COLLAPSE_AFTER : 0;
  let middleIndex = -1;
  const visible: (Step | "more")[] = [];
  for (const s of steps) {
    if (s.kind === "question" || s.kind === "reformulation") {
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
        <p className="mt-1 text-sm text-text-2">Datos observados, en el orden en que pasaron.</p>
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
              case "reformulation":
                return (
                  <Node key={i} tone="ink" label={s.label} at={s.at}>
                    <p className="text-[15px] leading-7 whitespace-pre-wrap text-text">{s.text}</p>
                  </Node>
                );
              case "final":
                return (
                  <Node key={i} tone="leaf" label="Respuesta final" at={s.at}>
                    {s.text ? (
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
      <aside className="space-y-4">
        <div className="rounded-lg border border-line bg-surface p-4 shadow-1">
          <h3 className="text-sm font-semibold text-text">En números</h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Preguntas del tutor" value={questions} />
            <Row label="Reformulaciones" value={reformulations} />
            <Row label="Pistas pedidas" value={detail.session.hintCount} />
            <Row label="Mensajes del alumno" value={detail.messages.filter((m) => m.role === "user").length} />
          </dl>
        </div>
        <p className="text-xs leading-5 text-text-3">
          «Pregunta del tutor» es la última pregunta de cada mensaje del tutor. Las reformulaciones son los mensajes que el alumno envió con «Quiero revisar mi
          respuesta», «Tengo otra idea» o «Quiero explicar lo que aprendí». La conversación completa está en la pestaña Conversación.
        </p>
      </aside>
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

// "Radiografía" tab: observed data per moment (before / during / after the tutor) and the
// AI interpretations, each quoting the student, that the teacher validates, edits or discards.
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { FormError, Textarea } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { fmtDateTime, plural } from "@client/lib/format";
import { EVENT_LABELS } from "@shared/domain/pedagogy";
import { XRAY_MOMENTS, type XrayItem, type XrayMoment } from "@shared/domain/thinking-xray";
import type { SessionDetail, XrayAnalyzeResult } from "@shared/contracts/sessions";
import { useSessionMutations } from "./api";

function resultMessage(r: XrayAnalyzeResult): string {
  const parts = [r.added ? `Se ${r.added === 1 ? "agregó 1 interpretación" : `agregaron ${r.added} interpretaciones`} para revisar.` : "No hay interpretaciones nuevas."];
  if (r.droppedQuotes) parts.push(`${plural(r.droppedQuotes, "propuesta se descartó", "propuestas se descartaron")} porque la cita no aparece en lo que escribió el alumno.`);
  if (r.duplicates) parts.push(`${plural(r.duplicates, "repetía", "repetían")} una que ya habías conservado o descartado.`);
  if (r.omittedMessages) parts.push(`Por la extensión, la IA no leyó ${plural(r.omittedMessages, "mensaje intermedio", "mensajes intermedios")}.`);
  return parts.join(" ");
}

export function XrayTab({ detail }: { detail: SessionDetail }) {
  const m = useSessionMutations(detail.session.id);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const x = detail.xray;
  const count = (type: string) => detail.events.filter((e) => e.eventType === type).length;
  const explanations = detail.messages.filter((msg) => msg.role === "user" && msg.intent === "explain");

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-display text-lg font-semibold text-ink">Radiografía del pensamiento</h2>
            <p className="mt-1 text-sm leading-6 text-text-2">
              En cada momento, arriba está lo que quedó registrado y abajo las interpretaciones de la IA: cada una cita textualmente algo que escribió el
              alumno (si la cita no aparece en su trabajo, se descarta sola). Vos decidís cuáles valen; las validadas van al PDF del recorrido.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            <Button
              variant="lilac"
              icon={x.aiGeneratedAt ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              loading={m.analyzeXray.isPending}
              onClick={() => {
                setError(null);
                setResult(null);
                m.analyzeXray.mutate(undefined, {
                  onSuccess: (r) => {
                    setResult(resultMessage(r));
                    toast.success("Análisis listo");
                  },
                  onError: (e) => setError(errorMessage(e)),
                });
              }}
            >
              {x.aiGeneratedAt ? "Volver a analizar" : "Analizar con IA"}
            </Button>
            {x.aiGeneratedAt ? <span className="text-xs text-text-3">Último análisis: {fmtDateTime(x.aiGeneratedAt)}</span> : null}
          </div>
        </div>
        <div className="mt-3 space-y-2" aria-live="polite">
          {m.analyzeXray.isPending ? <p className="text-sm text-lilac-ink">La IA está leyendo toda la conversación…</p> : null}
          {result ? <p className="rounded-md bg-lilac-soft/60 px-3 py-2 text-sm text-text-2">{result}</p> : null}
          <FormError message={error} />
        </div>
        {x.aiGeneratedAt ? (
          <p className="mt-2 text-xs text-text-3">
            Al volver a analizar se conservan las que validaste o editaste, y las que descartaste no vuelven.
            {x.discardedCount ? ` Descartaste ${plural(x.discardedCount, "interpretación", "interpretaciones")}.` : ""}
          </p>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <MomentColumn moment="before" detail={detail}>
          {detail.activity.requireInitialAnswer || detail.session.initialAnswer ? (
            <Observed label="Respuesta inicial" value={detail.session.initialAnswer} empty="Todavía no la escribió." />
          ) : (
            <p className="text-sm text-text-3">La actividad no pedía respuesta inicial.</p>
          )}
        </MomentColumn>
        <MomentColumn moment="during" detail={detail}>
          <ul className="space-y-1 text-sm text-text">
            <li>{plural(detail.flow.tutorQuestions.length, "pregunta del tutor", "preguntas del tutor")}</li>
            <li>{plural(detail.session.hintCount, "pista pedida", "pistas pedidas")}</li>
            <li>{plural(count("clarification_requested"), "vez indicó", "veces indicó")} que no entendió</li>
            <li>{plural(count("example_requested"), "ejemplo pedido", "ejemplos pedidos")}</li>
            <li>{plural(count("review_requested"), "pedido", "pedidos")} de revisar su respuesta</li>
            <li>{plural(count("alternative_idea"), "idea alternativa", "ideas alternativas")}</li>
          </ul>
        </MomentColumn>
        <MomentColumn moment="after" detail={detail}>
          <Observed label="Respuesta final" value={detail.session.finalAnswer} empty="Todavía no la escribió." />
          {explanations.length ? (
            <Observed label={EVENT_LABELS.explanation_offered ?? "Explicó lo que aprendió"} value={explanations.map((e) => e.content).join("\n\n")} empty="" />
          ) : null}
          {detail.session.reflection.length ? (
            <div>
              <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">Reflexión</p>
              <dl className="mt-1 space-y-2 text-sm">
                {detail.session.reflection.map((r, i) => (
                  <div key={i}>
                    <dt className="font-semibold text-text">{r.question}</dt>
                    <dd className="whitespace-pre-wrap text-text-2">{r.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </MomentColumn>
      </div>
    </div>
  );
}

function Observed({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">{label}</p>
      {value ? <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-text">{value}</p> : <p className="mt-1 text-sm text-text-3 italic">{empty}</p>}
    </div>
  );
}

function MomentColumn({ moment, detail, children }: { moment: XrayMoment; detail: SessionDetail; children: ReactNode }) {
  const def = XRAY_MOMENTS[moment];
  const items = detail.xray.items.filter((i) => i.moment === moment);
  const bar = moment === "before" ? "bg-line-strong" : moment === "during" ? "bg-lilac" : "bg-leaf-bright";
  return (
    <section aria-labelledby={`moment-${moment}`} className="relative overflow-hidden rounded-lg border border-line bg-surface p-5 shadow-1">
      <span className={cn("absolute inset-x-0 top-0 h-1", bar)} aria-hidden="true" />
      <h3 id={`moment-${moment}`} className="font-display text-lg font-semibold text-ink">
        {def.title}
      </h3>
      <div className="mt-3 space-y-3">
        <Badge tone="neutral">Dato observado</Badge>
        {children}
      </div>
      <div className="mt-5 space-y-3 border-t border-line pt-4">
        <Badge tone="lilac">Interpretación de la IA</Badge>
        {items.length === 0 ? (
          <p className="text-sm text-text-3">{detail.xray.aiGeneratedAt ? "Sin interpretaciones para este momento." : "Tocá «Analizar con IA» para pedir sugerencias."}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((i) => (
              <InterpretationCard key={i.id} item={i} sessionId={detail.session.id} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function InterpretationCard({ item, sessionId }: { item: XrayItem; sessionId: string }) {
  const m = useSessionMutations(sessionId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.interpretation);
  const [error, setError] = useState<string | null>(null);
  const label = XRAY_MOMENTS[item.moment].categories[item.category] ?? item.category;
  const busy = m.patchXray.isPending;
  const run = (body: { status?: "validated" | "discarded" | "suggested"; interpretation?: string }, ok: string, after?: () => void) => {
    setError(null);
    m.patchXray.mutate(
      { itemId: item.id, ...body },
      {
        onSuccess: () => {
          toast.success(ok);
          after?.();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };
  return (
    <li className={cn("rounded-md border p-3", item.status === "validated" ? "border-leaf/30 bg-leaf-soft/50" : "border-line bg-paper")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-text-3 uppercase">{label}</p>
        {item.status === "validated" ? (
          <Badge tone="leaf">
            <Check className="size-3" aria-hidden="true" /> Validada{item.edited ? " (editada)" : ""}
          </Badge>
        ) : (
          <Badge tone="amber">Por revisar</Badge>
        )}
      </div>
      {editing ? (
        <Textarea className="mt-2" value={text} maxLength={600} minRows={3} onChange={(e) => setText(e.target.value)} aria-label="Editar interpretación" />
      ) : (
        <p className="mt-1.5 text-sm leading-6 text-text">{item.interpretation}</p>
      )}
      <blockquote className="mt-2 border-l-2 border-lilac pl-3 text-sm text-text-2 italic">«{item.evidence}»</blockquote>
      <FormError message={error} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <Button size="sm" loading={busy} disabled={!text.trim()} onClick={() => run({ interpretation: text.trim(), status: "validated" }, "Interpretación guardada y validada", () => setEditing(false))}>
              Guardar y validar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setText(item.interpretation);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            {item.status !== "validated" ? (
              <Button size="sm" variant="secondary" icon={<Check className="size-4" />} loading={busy} onClick={() => run({ status: "validated" }, "Interpretación validada")}>
                Validar
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} disabled={busy} onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} disabled={busy} onClick={() => run({ status: "discarded" }, "Interpretación descartada")}>
              Descartar
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

// "Fortalezas y aspectos a reforzar" of one work: the AI suggests them with quotes when asked;
// the teacher removes what they do not share and marks aspects by hand. Everything here is
// counted in the activity's group view and on the student's page.
import { useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { cn } from "@client/lib/cn";
import { Badge } from "@client/components/ui/misc";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Input, Select } from "@client/components/ui/field";
import { errorMessage } from "@client/lib/api";
import { fmtDateTime, plural } from "@client/lib/format";
import { ASPECTS, ASPECT_KEYS, ASPECT_KIND_LABELS, ASPECT_NOTE_MAX, byKind, type AspectItem, type AspectKey, type AspectKind } from "@shared/domain/aspects";
import type { SessionDetail } from "@shared/contracts/sessions";
import { AspectGlyph, KIND_STYLE, KindHeading } from "@client/features/aspects/ui";
import { useSessionMutations } from "./api";

export function AspectsCard({ detail }: { detail: SessionDetail }) {
  const m = useSessionMutations(detail.session.id);
  const { items, aiGeneratedAt } = detail.aspects;
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = byKind(items);

  return (
    <section aria-labelledby="aspects-title" className="rounded-lg border border-line bg-surface p-5 shadow-1 sm:p-6 xl:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="aspects-title" className="font-display text-lg font-semibold text-ink">
          Fortalezas y aspectos a reforzar
        </h2>
        <Badge tone="lilac">
          <Sparkles className="size-3" aria-hidden="true" /> Inferencia de la IA
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-text-2">
        En qué se destacó y qué le conviene reforzar (por ejemplo, la redacción o el uso de los materiales), con citas de lo que escribió. Quitá lo que no
        compartas y marcá vos lo que veas: todo se suma a la vista del grupo en la actividad.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="lilac"
          icon={aiGeneratedAt ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
          loading={m.analyzeAspects.isPending}
          onClick={() => {
            setError(null);
            m.analyzeAspects.mutate(undefined, {
              onSuccess: (r) =>
                toast.success(r.droppedQuotes ? `Listo. Quitamos ${plural(r.droppedQuotes, "cita", "citas")} que el alumno no escribió.` : "Fortalezas y aspectos a reforzar listos"),
              onError: (e) => setError(errorMessage(e)),
            });
          }}
        >
          {aiGeneratedAt ? "Volver a analizar" : "Analizar con IA"}
        </Button>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          Marcar un aspecto
        </Button>
        {aiGeneratedAt ? <span className="text-xs text-text-3">Último análisis: {fmtDateTime(aiGeneratedAt)}</span> : null}
      </div>
      {m.analyzeAspects.isPending ? (
        <p role="status" className="mt-2 text-sm text-lilac-ink">
          La IA está leyendo el trabajo completo del alumno…
        </p>
      ) : null}
      <div className="mt-3">
        <FormError message={error} />
      </div>

      {adding ? <AddAspect detail={detail} items={items} onDone={() => setAdding(false)} /> : null}

      {items.length ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2" aria-live="polite">
          {(["strength", "reinforce"] as AspectKind[]).map((kind) => (
            <div key={kind} className={cn("rounded-[14px] p-4", KIND_STYLE[kind].soft)}>
              <KindHeading kind={kind} label={ASPECT_KIND_LABELS[kind]} count={groups[kind].length} />
              {groups[kind].length ? (
                <ul className="mt-3 space-y-2.5">
                  {groups[kind].map((item) => (
                    <AspectRow key={item.id} item={item} sessionId={detail.session.id} onError={setError} />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-text-2">{kind === "strength" ? "Todavía nada marcado." : "Nada para reforzar por ahora."}</p>
              )}
            </div>
          ))}
        </div>
      ) : !m.analyzeAspects.isPending ? (
        <p className="mt-4 rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-text-2">
          Todavía no hay fortalezas ni aspectos a reforzar. Pedile el análisis a la IA o marcalos vos.
        </p>
      ) : null}
    </section>
  );
}

function AspectRow({ item, sessionId, onError }: { item: AspectItem; sessionId: string; onError: (m: string) => void }) {
  const m = useSessionMutations(sessionId);
  const label = ASPECTS[item.aspect].label;
  const removing = m.removeAspect.isPending && m.removeAspect.variables === item.id;
  return (
    <li className={cn("relative flex gap-3 rounded-md bg-surface p-3 pr-12 shadow-1 transition-opacity sm:pr-10", removing && "opacity-50")}>
      <AspectGlyph aspect={item.aspect} kind={item.kind} />
      <div className="min-w-0 flex-1">
        <p className="pt-1.5 text-[15px] leading-5 font-semibold text-text">{label}</p>
        {item.source === "teacher" ? (
          <span className="mt-1.5 inline-flex rounded-full bg-ink-soft px-2 py-0.5 text-[11px] font-semibold text-ink">Marcado por vos</span>
        ) : null}
        {item.observation ? <p className="mt-1 text-sm leading-6 text-text-2">{item.observation}</p> : null}
        {item.evidence ? <blockquote className="mt-1.5 border-l-2 border-lilac pl-2.5 text-sm text-text-2 italic">«{item.evidence}»</blockquote> : null}
      </div>
      <button
        type="button"
        aria-label={`Quitar «${label}»`}
        title="Quitar"
        disabled={m.removeAspect.isPending}
        onClick={() =>
          m.removeAspect.mutate(item.id, {
            onSuccess: () => toast.success(`Quitamos «${label}»`),
            onError: (e) => onError(errorMessage(e)),
          })
        }
        className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md text-text-3 hover:bg-sunken hover:text-ink disabled:opacity-50 max-sm:top-0.5 max-sm:right-0.5 max-sm:size-11"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </li>
  );
}

function AddAspect({ detail, items, onDone }: { detail: SessionDetail; items: AspectItem[]; onDone: () => void }) {
  const m = useSessionMutations(detail.session.id);
  const [aspect, setAspect] = useState<AspectKey | "">("");
  const [kind, setKind] = useState<AspectKind>("strength");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const replaces = aspect ? items.some((i) => i.aspect === aspect) : false;

  return (
    <form
      className="mt-4 grid gap-4 rounded-[14px] border border-line bg-paper p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!aspect) {
          setError("Elegí un aspecto.");
          return;
        }
        setError(null);
        m.addAspect.mutate(
          { aspect, kind, note },
          {
            onSuccess: () => {
              toast.success(`Marcamos «${ASPECTS[aspect].label}» como ${kind === "strength" ? "fortaleza" : "aspecto a reforzar"}`);
              onDone();
            },
            onError: (err) => setError(errorMessage(err)),
          },
        );
      }}
    >
      <Field label="Aspecto" hint={replaces ? "Reemplaza lo que había sobre este aspecto." : undefined}>
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} value={aspect} onChange={(e) => setAspect(e.target.value as AspectKey)}>
            <option value="">Elegí un aspecto…</option>
            {ASPECT_KEYS.map((k) => (
              <option key={k} value={k}>
                {ASPECTS[k].label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-text">¿Qué muestra?</legend>
        <div className="inline-flex rounded-full border border-line-strong bg-surface p-1">
          {(["strength", "reinforce"] as AspectKind[]).map((k) => {
            const Icon = KIND_STYLE[k].icon;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors max-sm:min-h-11",
                  kind === k ? KIND_STYLE[k].tile : "text-text-2 hover:text-ink",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {k === "strength" ? "Se destacó" : "A reforzar"}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label="Nota" optional className="sm:col-span-2" counter={{ value: note.length, max: ASPECT_NOTE_MAX }}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={note}
            maxLength={ASPECT_NOTE_MAX}
            placeholder="Por ejemplo: usó bien los datos del texto."
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={m.addAspect.isPending}>
          Marcar aspecto
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <FormError message={error} />
      </div>
    </form>
  );
}

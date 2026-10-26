// How the activity is organized for the student: the presentation, the consignas (cards with
// their own title, instructions and written answer), the modality, the titles and subtitles the
// students read, «Agregar sección» and a preview of the student's screens.
import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Eye, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Menu, Switch } from "@client/components/ui/controls";
import { ConfirmDialog, Dialog } from "@client/components/ui/dialog";
import { Field, Input, Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { plural } from "@client/lib/format";
import { ACTIVITY_LIMITS, type ActivityEditorData } from "@shared/contracts/activities";
import { MAX_CONSIGNAS } from "@shared/domain/consignas";
import { DEFAULT_FINAL_QUESTION_BY_LANGUAGE } from "@shared/domain/language";
import {
  ACTIVITY_MODES,
  CONSIGNA_TITLE_MAX,
  MODE_LABELS,
  PRESENTATION_MAX,
  SECTION_DEFAULTS,
  SECTION_SUBTITLE_MAX,
  SECTION_TITLE_MAX,
  consignaTitle,
  modeOf,
  sectionText,
  type ActivityMode,
  type Consigna,
  type SectionKey,
} from "@shared/domain/structure";
import { RadioCards } from "./parts";
import type { ActivityForm } from "./use-activity-form";

const newId = () => `c${Math.random().toString(36).slice(2, 9)}`;

// ── Titles and subtitles the students read ──

export function StudentTitleFields({ form, section, defaultTitle }: { form: ActivityForm; section: SectionKey; defaultTitle?: string }) {
  const { draft, set } = form;
  const own = draft.sectionTitles[section];
  const d = SECTION_DEFAULTS[draft.language][section];
  const shown = sectionText(draft.sectionTitles, section, draft.language);
  const [open, setOpen] = useState(Boolean(own?.title || own?.subtitle));
  const update = (patch: Partial<{ title: string; subtitle: string }>) => {
    const next = { title: own?.title ?? "", subtitle: own?.subtitle ?? "", ...patch };
    const titles = { ...draft.sectionTitles };
    if (next.title || next.subtitle) titles[section] = next;
    else delete titles[section];
    set("sectionTitles", titles);
  };
  if (!open) {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-text-3">
        Los alumnos leen: <span className="font-semibold text-text-2">«{defaultTitle && !own?.title ? defaultTitle : shown.title}»</span>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1 font-semibold text-ink underline decoration-lilac underline-offset-4">
          <Pencil className="size-3.5" aria-hidden="true" />
          Cambiar título y subtítulo
        </button>
      </p>
    );
  }
  return (
    <div className="mt-4 grid gap-3 rounded-[12px] border border-dashed border-line-strong bg-paper/60 p-3.5 sm:grid-cols-2">
      <Field label="Título que ven los alumnos" optional counter={{ value: own?.title.length ?? 0, max: SECTION_TITLE_MAX }}>
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            value={own?.title ?? ""}
            maxLength={SECTION_TITLE_MAX}
            placeholder={defaultTitle ?? d.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <Field label="Subtítulo" optional counter={{ value: own?.subtitle.length ?? 0, max: SECTION_SUBTITLE_MAX }}>
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            value={own?.subtitle ?? ""}
            maxLength={SECTION_SUBTITLE_MAX}
            placeholder={d.subtitle || "Una línea que aclare la sección"}
            onChange={(e) => update({ subtitle: e.target.value })}
          />
        )}
      </Field>
      <p className="text-[13px] leading-5 text-text-3 sm:col-span-2">Si los dejás vacíos, los alumnos leen el título y el texto de siempre.</p>
    </div>
  );
}

// ── Presentation ──

export function PresentationEditor({ form }: { form: ActivityForm }) {
  const { draft, set, errors } = form;
  return (
    <>
      <Switch
        checked={draft.presentationOn}
        onCheckedChange={(v) => set("presentationOn", v)}
        label="Mostrar una presentación antes de empezar"
        description={
          draft.presentationOn
            ? "Los alumnos la leen primero y tocan «Comenzar actividad». La pueden volver a consultar cuando quieran."
            : "Los alumnos empiezan directamente por la actividad."
        }
      />
      {draft.presentationOn ? (
        <>
          <Field className="mt-4" label="Texto de la presentación" error={errors.presentation} counter={{ value: draft.presentation.length, max: PRESENTATION_MAX }}>
            {(p) => (
              <Textarea
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                value={draft.presentation}
                maxLength={PRESENTATION_MAX}
                minRows={4}
                maxRows={16}
                onChange={(e) => set("presentation", e.target.value)}
                placeholder="Ej.: ¡La agencia espacial necesita tu ayuda! Tu desafío será diseñar una misión de exploración a un planeta del Sistema Solar…"
              />
            )}
          </Field>
          <StudentTitleFields form={form} section="presentacion" />
        </>
      ) : null}
    </>
  );
}

// ── Modality ──

export function ModeSelector({ form }: { form: ActivityForm }) {
  const { draft, set } = form;
  const mode = modeOf(draft.consignas, draft.askFinalAnswer);
  const apply = (m: ActivityMode) => {
    set(
      "consignas",
      draft.consignas.map((c) => ({ ...c, answer: m === "respuestas" })),
    );
    set("askFinalAnswer", m === "produccion");
  };
  return (
    <RadioCards<ActivityMode>
      name="activity-mode"
      legend="Modalidad"
      value={mode}
      onChange={apply}
      options={ACTIVITY_MODES.map((m) => ({ value: m, label: MODE_LABELS[m].title, description: MODE_LABELS[m].description }))}
    />
  );
}

// ── Consignas ──

export function ConsignasEditor({ form, participants }: { form: ActivityForm; participants: number }) {
  const { draft, set, errors } = form;
  const list = draft.consignas;
  const [removing, setRemoving] = useState<number | null>(null);
  const update = (i: number, patch: Partial<Consigna>) => set("consignas", list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, to: number) => {
    const next = [...list];
    const [c] = next.splice(i, 1);
    next.splice(to, 0, c!);
    set("consignas", next);
  };
  const remove = (i: number) => set("consignas", list.filter((_, j) => j !== i));
  const add = (after?: number, copy?: Consigna) => {
    const c: Consigna = copy ? { ...copy, id: newId(), title: copy.title ? `${copy.title} (copia)`.slice(0, CONSIGNA_TITLE_MAX) : "" } : { id: newId(), title: "", text: "", answer: list.some((x) => x.answer) };
    const next = [...list];
    next.splice(after === undefined ? next.length : after + 1, 0, c);
    set("consignas", next);
    requestAnimationFrame(() => document.getElementById(`consigna-text-${c.id}`)?.focus());
  };

  return (
    <div className="grid gap-3">
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-3 text-sm text-text-2">Todavía no hay consignas. Agregá la primera.</p>
      ) : null}
      {list.map((c, i) => (
        <article key={c.id} className="rounded-[14px] border border-line bg-paper/50 p-3.5 sm:p-4" aria-label={`Consigna ${i + 1}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-lilac-soft text-[13px] font-bold text-lilac-ink tabular" aria-hidden="true">
              {i + 1}
            </span>
            <label className="sr-only" htmlFor={`consigna-title-${c.id}`}>
              Título de la consigna {i + 1}
            </label>
            <Input
              id={`consigna-title-${c.id}`}
              // On a phone the title gets its own line under the number and the buttons.
              className="order-last h-10 w-full min-w-0 font-semibold sm:order-none sm:w-auto sm:flex-1"
              value={c.title}
              maxLength={CONSIGNA_TITLE_MAX}
              placeholder={consignaTitle({ title: "" }, i, draft.language)}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <div className="ml-auto flex shrink-0 items-center sm:ml-0">
              <Button type="button" variant="ghost" size="icon" aria-label={`Subir la consigna ${i + 1}`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Bajar la consigna ${i + 1}`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`Duplicar la consigna ${i + 1}`} disabled={list.length >= MAX_CONSIGNAS} onClick={() => add(i, c)}>
                <Copy className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-rose hover:bg-rose-soft hover:text-rose"
                aria-label={`Eliminar la consigna ${i + 1}`}
                onClick={() => (participants > 0 && c.text.trim() ? setRemoving(i) : remove(i))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <Field className="mt-3" label="Instrucciones" error={errors[`consignas.${i}.text`]} counter={{ value: c.text.length, max: ACTIVITY_LIMITS.instructions }}>
            {(p) => (
              <Textarea
                id={`consigna-text-${c.id}`}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                value={c.text}
                maxLength={ACTIVITY_LIMITS.instructions}
                minRows={3}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder={i === 0 ? "Ej.: Elegí un planeta y justificá por qué te parece una buena opción para explorarlo." : "Ej.: Identificá los desafíos que encontrarías y proponé soluciones."}
              />
            )}
          </Field>
          <div className="mt-3">
            <Switch
              checked={c.answer}
              onCheckedChange={(v) => update(i, { answer: v })}
              label="Respuesta escrita"
              description={c.answer ? "El alumno escribe su respuesta en esta consigna, además de conversar con el tutor." : "Esta consigna solo orienta la conversación con el tutor."}
            />
          </div>
        </article>
      ))}
      {errors.consignas ? <p className="text-[13px] font-medium text-rose">{errors.consignas}</p> : null}
      {list.length < MAX_CONSIGNAS ? (
        <button
          type="button"
          onClick={() => add()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-dashed border-lilac/60 bg-lilac-soft/30 text-[15px] font-semibold text-lilac-ink transition-colors hover:bg-lilac-soft/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac-ink"
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar consigna
        </button>
      ) : (
        <p className="text-[13px] text-text-3">Llegaste al máximo de {MAX_CONSIGNAS} consignas.</p>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="¿Eliminar esta consigna?"
        description={
          <p>
            {plural(participants, "alumno ya trabajó", "alumnos ya trabajaron")} en esta actividad. Lo que respondieron se conserva en sus trabajos, pero
            esta consigna deja de mostrarse cuando guardes.
          </p>
        }
        confirmLabel="Eliminar consigna"
        onConfirm={() => {
          if (removing !== null) remove(removing);
          setRemoving(null);
        }}
      />
    </div>
  );
}

// ── «Agregar sección»: turn on a section that is off and go to it ──

const OPTIONAL_SECTIONS: { id: string; label: string; isOn: (f: ActivityForm["draft"]) => boolean; turnOn: (f: ActivityForm) => void }[] = [
  { id: "presentacion", label: "Presentación", isOn: (d) => d.presentationOn, turnOn: (f) => f.set("presentationOn", true) },
  { id: "objetivos", label: "Objetivos para los alumnos", isOn: (d) => d.objectivesVisible, turnOn: (f) => f.set("objectivesVisible", true) },
  { id: "respuesta-inicial", label: "Respuesta inicial", isOn: (d) => d.requireInitialAnswer, turnOn: (f) => f.set("requireInitialAnswer", true) },
  { id: "respuesta-final", label: "Respuesta final", isOn: (d) => d.askFinalAnswer, turnOn: (f) => f.set("askFinalAnswer", true) },
  { id: "reflexion", label: "Reflexión final", isOn: (d) => d.askReflection, turnOn: (f) => f.set("askReflection", true) },
  { id: "mensaje-final", label: "Mensaje final", isOn: (d) => d.closingMessageOn, turnOn: (f) => f.set("closingMessageOn", true) },
  { id: "entrega", label: "Entrega (archivo o enlace)", isOn: (d) => d.deliverableMode !== "off", turnOn: (f) => f.set("deliverableMode", "optional") },
  { id: "devolucion", label: "Devolución de la IA", isOn: (d) => d.shareSummary, turnOn: (f) => f.set("shareSummary", true) },
];

export function AddSectionMenu({ form, onGo }: { form: ActivityForm; onGo: (id: string) => void }) {
  const off = OPTIONAL_SECTIONS.filter((s) => !s.isOn(form.draft));
  return (
    <Menu
      align="start"
      trigger={
        <Button type="button" variant="secondary" size="sm" icon={<Plus className="size-4" />} disabled={off.length === 0}>
          Agregar sección
        </Button>
      }
      items={
        off.length
          ? off.map((s) => ({
              label: s.label,
              onSelect: () => {
                s.turnOn(form);
                onGo(s.id);
              },
            }))
          : [{ label: "Todas las secciones están activas", onSelect: () => {}, disabled: true }]
      }
    />
  );
}

// ── Preview: the student's screens with what is being edited ──

export function PreviewButton({ activity, form }: { activity: ActivityEditorData; form: ActivityForm }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" icon={<Eye className="size-4" />} onClick={() => setOpen(true)}>
        Vista previa
      </Button>
      <PreviewDialog open={open} onOpenChange={setOpen} activity={activity} form={form} />
    </>
  );
}

function PreviewDialog({ open, onOpenChange, activity, form }: { open: boolean; onOpenChange: (o: boolean) => void; activity: ActivityEditorData; form: ActivityForm }) {
  const d = form.draft;
  const lang = d.language;
  const t = (k: SectionKey) => sectionText(d.sectionTitles, k, lang);
  const consignas = d.consignas.filter((c) => c.text.trim());
  const [screen, setScreen] = useState<"intro" | number | "closing">(d.presentationOn && d.presentation.trim() ? "intro" : 0);
  const idx = typeof screen === "number" ? Math.min(screen, Math.max(0, consignas.length - 1)) : 0;
  const c = consignas[idx];
  const finalQ = d.finalQuestion.trim() || DEFAULT_FINAL_QUESTION_BY_LANGUAGE[lang];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Vista previa" description="Así ven la actividad tus alumnos en el celular, con lo que estás editando (aunque no lo hayas guardado).">
      <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-center">
        <nav aria-label="Pantallas" className="flex flex-wrap justify-center gap-1.5 lg:w-48 lg:flex-col">
          {d.presentationOn && d.presentation.trim() ? <ScreenTab active={screen === "intro"} onClick={() => setScreen("intro")} label="Presentación" /> : null}
          {consignas.map((x, i) => (
            <ScreenTab key={x.id} active={screen === i} onClick={() => setScreen(i)} label={consignas.length > 1 ? `Consigna ${i + 1}` : "Consigna"} />
          ))}
          <ScreenTab active={screen === "closing"} onClick={() => setScreen("closing")} label="Cierre" />
        </nav>
        <div className="w-[min(360px,100%)] rounded-[28px] border-[6px] border-ink/85 bg-paper shadow-pop">
          <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
            <Smartphone className="size-4 text-text-3" aria-hidden="true" />
            <span className="truncate font-display text-[15px] font-semibold text-ink">{activity.title}</span>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3.5 text-left">
            {screen === "intro" ? (
              <>
                <div className="rounded-xl border border-line bg-surface p-4 shadow-1">
                  <p className="font-display text-xl font-semibold text-ink">{t("presentacion").title}</p>
                  {t("presentacion").subtitle ? <p className="mt-1 text-sm text-text-2">{t("presentacion").subtitle}</p> : null}
                  <p className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-text">{d.presentation}</p>
                </div>
                {d.objectivesVisible && d.objectives.trim() ? (
                  <div className="rounded-xl border border-line bg-surface p-4 shadow-1">
                    <p className="font-display font-semibold text-ink">{t("objetivos").title}</p>
                    <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-text">{d.objectives}</p>
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <span className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-4 text-[15px] font-semibold text-white">
                    {lang === "en" ? "Start the activity" : "Comenzar actividad"} <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </div>
              </>
            ) : screen === "closing" ? (
              <div className="rounded-xl border border-line bg-surface p-4 shadow-1">
                <p className="text-sm font-semibold text-lilac-ink">{lang === "en" ? "To finish" : "Para terminar"}</p>
                {d.askFinalAnswer ? (
                  <>
                    <p className="mt-1 font-display text-lg font-semibold text-ink">{finalQ}</p>
                    <p className="mt-1 text-sm text-text-2">{t("respuesta_final").subtitle}</p>
                    <p className="mt-3 text-sm font-semibold text-text">{t("respuesta_final").title}</p>
                    <div className="mt-1 h-16 rounded-md border border-line-strong bg-surface" />
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-2">{lang === "en" ? "No final answer is asked." : "No se pide una respuesta final."}</p>
                )}
                {d.closingMessageOn && d.closingMessage.trim() ? (
                  <div className="mt-3 rounded-[12px] bg-lilac-soft/70 px-3 py-2.5">
                    <p className="text-[11px] font-semibold tracking-wide text-lilac-ink uppercase">{t("cierre").title}</p>
                    <p className="mt-0.5 text-sm whitespace-pre-wrap text-text">{d.closingMessage}</p>
                  </div>
                ) : null}
                {d.askReflection && d.reflectionQuestions.length ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="font-display font-semibold text-ink">{t("reflexion").title}</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-text-2">
                      {d.reflectionQuestions.map((q) => (
                        <li key={q.key}>{q.question}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : c ? (
              <div className="rounded-xl border border-line bg-surface p-4 shadow-1">
                <p className="text-sm font-semibold text-lilac-ink">
                  {consignas.length > 1 ? (lang === "en" ? `Task ${idx + 1} of ${consignas.length}` : `Consigna ${idx + 1} de ${consignas.length}`) : lang === "en" ? "Task" : "Consigna"}
                </p>
                <p className="mt-1 font-display text-lg font-semibold text-ink">{consignaTitle(c, idx, lang)}</p>
                <p className="mt-2 text-[15px] leading-6 whitespace-pre-wrap text-text">{c.text}</p>
                {c.answer ? (
                  <>
                    <p className="mt-3 text-sm font-semibold text-text">{lang === "en" ? "Your answer" : "Tu respuesta"}</p>
                    <div className="mt-1 h-16 rounded-md border border-line-strong bg-surface" />
                  </>
                ) : null}
                {consignas.length > 1 ? (
                  <div className="mt-3 flex justify-between border-t border-line pt-3">
                    <button type="button" disabled={idx === 0} onClick={() => setScreen(idx - 1)} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink disabled:opacity-40">
                      <ArrowLeft className="size-4" aria-hidden="true" /> {lang === "en" ? "Previous" : "Anterior"}
                    </button>
                    <button
                      type="button"
                      disabled={idx === consignas.length - 1}
                      onClick={() => setScreen(idx + 1)}
                      className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink disabled:opacity-40"
                    >
                      {lang === "en" ? "Next" : "Siguiente"} <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <div className="mt-3 rounded-[12px] bg-sunken px-3 py-2.5 text-[13px] text-text-2">{lang === "en" ? "Chat with the tutor…" : "Conversación con el tutor…"}</div>
              </div>
            ) : (
              <p className="text-sm text-text-2">Todavía no hay consignas.</p>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ScreenTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full px-3.5 text-sm font-semibold transition-colors max-sm:min-h-11 lg:text-left",
        active ? "bg-ink text-white" : "bg-sunken text-text-2 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

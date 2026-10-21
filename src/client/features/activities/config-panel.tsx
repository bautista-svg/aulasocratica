// "Configuración" tab: everything the teacher prepares before (and while) students work.
// One explicit "Guardar cambios" for all sections (files and notes save on their own).
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Save } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Switch } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { Field, Input, Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { ApiError, errorMessage } from "@client/lib/api";
import { VOICE_LANGUAGE_LABELS, type VoiceLanguage } from "@shared/domain/voice";
import { ACTIVITY_LIMITS, type ActivityEditorData } from "@shared/contracts/activities";
import { useSaveActivity } from "./api";
import { EditorSection, RadioCards } from "./parts";
import { MaterialFiles } from "./material-files";
import { TutorSection } from "./tutor-section";
import { RubricEditor } from "./rubric-editor";
import { ReflectionEditor } from "./reflection-editor";
import { errorKeyBelongsTo, type ActivityForm, type DraftKey, type FieldErrors } from "./use-activity-form";
import { useKeepFieldVisible, useKeyboardOpen } from "./keep-field-visible";

export const SECTIONS: { id: string; title: string; keys: DraftKey[] }[] = [
  { id: "consigna", title: "Consigna", keys: ["instructions"] },
  { id: "objetivos", title: "Objetivos", keys: ["objectives", "subject"] },
  { id: "material", title: "Material", keys: ["material"] },
  { id: "tutor", title: "Tutor", keys: ["tutorType", "helpLevel", "tutorRules"] },
  { id: "respuesta-inicial", title: "Respuesta inicial", keys: ["requireInitialAnswer"] },
  { id: "voz", title: "Voz", keys: ["voiceLanguage"] },
  { id: "rubrica", title: "Rúbrica", keys: ["rubric"] },
  { id: "reflexion", title: "Reflexión final", keys: ["reflectionQuestions"] },
];

function sectionOfError(errors: FieldErrors): string | null {
  for (const s of SECTIONS) if (Object.keys(errors).some((p) => s.keys.some((k) => errorKeyBelongsTo(p, k)))) return s.id;
  return null;
}

export function scrollToSection(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/** Validates and saves the draft. Resolves true when everything is saved. */
export function useSaveDraft(activity: ActivityEditorData, form: ActivityForm, onErrors?: () => void) {
  const save = useSaveActivity(activity.id);
  const run = useCallback(
    async (opts: { quiet?: boolean } = {}): Promise<boolean> => {
      const built = form.buildPatch();
      if (built.errors) {
        form.setErrors(built.errors);
        onErrors?.();
        const s = sectionOfError(built.errors);
        if (s) scrollToSection(s);
        toast.error("Revisá los campos marcados antes de guardar.");
        return false;
      }
      if (Object.keys(built.patch).length === 0) return true;
      try {
        const r = await save.mutateAsync(built.patch);
        form.saved(built.patch, r.activity);
        if (!opts.quiet) toast.success("Cambios guardados");
        return true;
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.fields).length) {
          form.setErrors(e.fields);
          onErrors?.();
          const s = sectionOfError(e.fields);
          if (s) scrollToSection(s);
        }
        toast.error(errorMessage(e) || "No se pudieron guardar los cambios.");
        return false;
      }
    },
    [form, save, onErrors],
  );
  return { run, pending: save.isPending };
}

export function ConfigPanel({ activity, form, saving, onSave }: { activity: ActivityEditorData; form: ActivityForm; saving: boolean; onSave: () => void }) {
  const { draft, set, errors, dirtyKeys, dirty } = form;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sectionDirty = (keys: DraftKey[]) => keys.some((k) => dirtyKeys.includes(k));
  const sectionError = (keys: DraftKey[]) => Object.keys(errors).some((p) => keys.some((k) => errorKeyBelongsTo(p, k)));
  const meta = (id: string) => {
    const s = SECTIONS.find((x) => x.id === id)!;
    return { dirty: sectionDirty(s.keys), error: sectionError(s.keys) };
  };
  const aiContext = {
    title: activity.title,
    subject: draft.subject,
    objectives: draft.objectives,
    instructions: draft.instructions,
    material: draft.material.slice(0, ACTIVITY_LIMITS.material),
  };
  const dirtyTitles = SECTIONS.filter((s) => sectionDirty(s.keys)).map((s) => s.title);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useKeyboardOpen();
  const barShown = dirty && !keyboardOpen;
  useKeepFieldVisible(rootRef, barRef, barShown);

  return (
    // scroll-mb: fields brought into view (focus, scrollIntoView) stop above the save bar and the phone tab bar.
    <div ref={rootRef} className="lg:grid lg:grid-cols-[minmax(0,1fr)_190px] lg:gap-8 [&_input]:scroll-mb-44 [&_textarea]:scroll-mb-44 lg:[&_input]:scroll-mb-24 lg:[&_textarea]:scroll-mb-24">
      <div className="grid min-w-0 gap-4">
        <EditorSection id="consigna" title="Consigna" description="Lo primero que leen tus alumnos al entrar. Escribila como una pregunta o un desafío." {...meta("consigna")}>
          <Field label="Consigna" error={errors.instructions} counter={{ value: draft.instructions.length, max: ACTIVITY_LIMITS.instructions }}>
            {(p) => (
              <Textarea
                id={p.id}
                aria-describedby={p.describedBy}
                invalid={p.invalid}
                value={draft.instructions}
                onChange={(e) => set("instructions", e.target.value)}
                minRows={4}
                placeholder="Ej.: ¿Cómo podrías saber si 123 es divisible por 3 sin hacer la división?"
              />
            )}
          </Field>
        </EditorSection>

        <EditorSection id="objetivos" title="Objetivos" description="Qué querés que aprendan. El tutor los usa para orientar la conversación." {...meta("objetivos")}>
          <div className="grid gap-4">
            <Field label="Objetivos de aprendizaje" optional error={errors.objectives} counter={{ value: draft.objectives.length, max: ACTIVITY_LIMITS.objectives }}>
              {(p) => (
                <Textarea
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.objectives}
                  onChange={(e) => set("objectives", e.target.value)}
                  minRows={3}
                  placeholder="Ej.: Descubrir y justificar el criterio de divisibilidad por 3."
                />
              )}
            </Field>
            <Field label="Materia" optional error={errors.subject} className="sm:max-w-sm">
              {(p) => (
                <Input
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  maxLength={ACTIVITY_LIMITS.subject}
                  placeholder="Ej.: Matemática"
                />
              )}
            </Field>
          </div>
        </EditorSection>

        <EditorSection
          id="material"
          title="Material"
          description="Texto y archivos en los que se apoya el tutor. Lo que está escrito dentro del material se toma como contenido, no como instrucciones para el tutor."
          {...meta("material")}
        >
          <div className="grid gap-5">
            <Field
              label="Material escrito"
              optional
              error={errors.material}
              counter={{ value: draft.material.length, max: ACTIVITY_LIMITS.material }}
              hint="Definiciones, un texto breve, datos o fuentes. Se guarda con «Guardar cambios»."
            >
              {(p) => (
                <Textarea
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.material}
                  onChange={(e) => set("material", e.target.value)}
                  minRows={4}
                  maxRows={18}
                />
              )}
            </Field>
            <div>
              <h3 className="text-sm font-semibold text-text">Archivos</h3>
              <p className="mt-0.5 mb-3 text-[13px] leading-5 text-text-3">Se guardan apenas terminan de subir; después se leen solos y ves el estado de cada uno.</p>
              <MaterialFiles activityId={activity.id} writtenChars={draft.material.length} />
            </div>
          </div>
        </EditorSection>

        <EditorSection id="tutor" title="Tutor" description="Cómo conversa el tutor con tus alumnos." {...meta("tutor")}>
          <TutorSection activity={activity} form={form} />
        </EditorSection>

        <EditorSection id="respuesta-inicial" title="Respuesta inicial" {...meta("respuesta-inicial")}>
          <Switch
            checked={draft.requireInitialAnswer}
            onCheckedChange={(v) => set("requireInitialAnswer", v)}
            label="Pedir una respuesta inicial antes de hablar con el tutor"
            description={
              draft.requireInitialAnswer
                ? "Cada alumno escribe primero lo que piensa, sin ayuda. Así podés comparar su primera idea con la respuesta final."
                : "Los alumnos empiezan directamente a conversar con el tutor, sin escribir una primera respuesta."
            }
          />
          <p className="mt-3 text-[13px] leading-5 text-text-3">
            Desactivala cuando no corresponda para esta actividad, por ejemplo en un repaso o en una charla con un personaje.
          </p>
        </EditorSection>

        <EditorSection
          id="voz"
          title="Voz"
          description={
            <span className="flex items-start gap-1.5">
              <Mic className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
              Usa el micrófono y la voz del navegador del alumno: el dictado lo procesa el servicio de voz del navegador (Google, Microsoft o
              Apple) y a la app llega solo el texto. Si su navegador no lo permite, escribe como siempre.
            </span>
          }
          {...meta("voz")}
        >
          <RadioCards<VoiceLanguage>
            name="voice-language"
            legend="Conversación por voz"
            value={draft.voiceLanguage}
            onChange={(v) => set("voiceLanguage", v)}
            options={(Object.keys(VOICE_LANGUAGE_LABELS) as VoiceLanguage[]).map((k) => ({
              value: k,
              label: VOICE_LANGUAGE_LABELS[k].label,
              description: VOICE_LANGUAGE_LABELS[k].description,
            }))}
          />
          {draft.voiceLanguage !== "off" ? (
            <p className="mt-3 text-[13px] leading-5 text-text-3">Lo que dicen queda escrito en la conversación, así lo ves en «En vivo».</p>
          ) : null}
          {errors.voiceLanguage ? <p className="mt-1.5 text-[13px] font-medium text-rose">{errors.voiceLanguage}</p> : null}
        </EditorSection>

        <EditorSection id="rubrica" title="Rúbrica" description="Los criterios y niveles con los que vas a evaluar el trabajo de cada alumno en esta actividad." {...meta("rubrica")}>
          <RubricEditor activityId={activity.id} form={form} context={aiContext} />
        </EditorSection>

        <EditorSection
          id="reflexion"
          title="Reflexión final"
          description="Preguntas que el alumno responde al terminar, junto con su respuesta final. Podés dejar pocas, cambiarlas o no poner ninguna."
          {...meta("reflexion")}
        >
          <ReflectionEditor activityId={activity.id} form={form} context={aiContext} />
        </EditorSection>

        {/* Save bar: sticks above the phone tab bar while there are unsaved changes; it steps aside while the
            on-screen keyboard is open so it never covers the field being edited (D09). */}
        <div
          ref={barRef}
          className={cn(
            "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4",
            barShown ? "visible" : "invisible h-0 overflow-hidden",
          )}
          aria-hidden={!barShown}
        >
          <div className="flex flex-col gap-3 rounded-lg border border-line-strong bg-surface/95 px-4 py-3 shadow-pop backdrop-blur sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-text-2" aria-live="polite">
              <span className="font-semibold text-text">Cambios sin guardar</span>
              {dirtyTitles.length ? <span className="hidden sm:inline"> · {dirtyTitles.join(", ")}</span> : null}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1 sm:flex-none" disabled={saving || !dirty} onClick={() => setConfirmDiscard(true)}>
                Descartar
              </Button>
              <Button className="flex-1 sm:flex-none" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={onSave}>
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      </div>

      <nav aria-label="Secciones de la configuración" className="hidden lg:block">
        <div className="sticky top-8">
          <p className="mb-2 text-xs font-semibold tracking-wide text-text-3 uppercase">En esta pestaña</p>
          <ul className="grid gap-0.5">
            {SECTIONS.map((s) => {
              const m = meta(s.id);
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(s.id);
                    }}
                    className="flex h-9 items-center justify-between gap-2 rounded-sm px-2.5 text-sm font-semibold text-text-2 hover:bg-sunken hover:text-ink"
                  >
                    {s.title}
                    {m.error ? (
                      <span className="size-2 rounded-full bg-rose" aria-label="con errores" />
                    ) : m.dirty ? (
                      <span className="size-2 rounded-full bg-amber" aria-label="sin guardar" />
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
          <p className={cn("mt-4 rounded-sm px-2.5 py-2 text-xs font-semibold", dirty ? "bg-amber-soft text-amber" : "bg-sunken text-text-3")}>
            {dirty ? "Hay cambios sin guardar" : "Todo guardado"}
          </p>
        </div>
      </nav>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="¿Descartar los cambios?"
        description={<p>Se pierde lo que editaste desde la última vez que guardaste: {dirtyTitles.join(", ") || "sin cambios"}. Los archivos subidos no se tocan.</p>}
        confirmLabel="Descartar cambios"
        onConfirm={() => {
          form.discard();
          setConfirmDiscard(false);
          toast.success("Cambios descartados");
        }}
      />
    </div>
  );
}

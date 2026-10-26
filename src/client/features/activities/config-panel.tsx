// "Configuración" tab: everything the teacher prepares before (and while) students work.
// One explicit "Guardar cambios" for all sections (files and notes save on their own).
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Paperclip, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Switch } from "@client/components/ui/controls";
import { ConfirmDialog } from "@client/components/ui/dialog";
import { Field, Input, Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { Notice } from "@client/components/ui/misc";
import { plural } from "@client/lib/format";
import { ApiError, errorMessage } from "@client/lib/api";
import { VOICE_LANGUAGE_LABELS, type VoiceLanguage } from "@shared/domain/voice";
import { DELIVERABLE_MODES, DELIVERABLE_PROMPT_MAX, MAX_DELIVERABLE_LABEL, type DeliverableMode } from "@shared/domain/deliverables";
import { ACTIVITY_LIMITS, type ActivityEditorData } from "@shared/contracts/activities";
import { CLOSING_MESSAGE_MAX, DEFAULT_FINAL_QUESTION, FINAL_QUESTION_MAX, MAX_CONSIGNAS } from "@shared/domain/consignas";
import { DEFAULT_FINAL_QUESTION_BY_LANGUAGE } from "@shared/domain/language";
import { defaultBasis } from "@shared/domain/session-summary";
import { LanguageSwitch } from "./language-switch";
import { useSaveActivity } from "./api";
import { EditorSection, RadioCards } from "./parts";
import { AddSectionMenu, ConsignasEditor, ModeSelector, PresentationEditor, PreviewButton, StudentTitleFields } from "./structure-editor";
import { MaterialFiles } from "./material-files";
import { TutorSection } from "./tutor-section";
import { RubricEditor } from "./rubric-editor";
import { ReflectionEditor } from "./reflection-editor";
import { errorKeyBelongsTo, type ActivityForm, type DraftKey, type FieldErrors } from "./use-activity-form";
import { useKeepFieldVisible, useKeyboardOpen } from "./keep-field-visible";

export const SECTIONS: { id: string; title: string; keys: DraftKey[] }[] = [
  { id: "idioma", title: "Idioma", keys: ["language"] },
  { id: "presentacion", title: "Presentación", keys: ["presentationOn", "presentation"] },
  { id: "objetivos", title: "Objetivos", keys: ["objectives", "subject", "objectivesVisible"] },
  { id: "consigna", title: "Consignas", keys: ["consignas"] },
  { id: "material", title: "Material", keys: ["material"] },
  { id: "tutor", title: "Tutor", keys: ["tutorType", "extraTutorTypes", "helpLevel", "tutorRules"] },
  { id: "respuesta-inicial", title: "Respuesta inicial", keys: ["requireInitialAnswer"] },
  { id: "respuesta-final", title: "Respuesta final", keys: ["askFinalAnswer", "finalQuestion"] },
  { id: "voz", title: "Voz", keys: ["voiceLanguage"] },
  { id: "rubrica", title: "Rúbrica", keys: ["rubric"] },
  { id: "reflexion", title: "Reflexión final", keys: ["askReflection", "reflectionQuestions"] },
  { id: "mensaje-final", title: "Mensaje final", keys: ["closingMessageOn", "closingMessage"] },
  { id: "entrega", title: "Entrega (archivo o enlace)", keys: ["deliverableMode", "deliverablePrompt"] },
  { id: "devolucion", title: "Devolución de la IA", keys: ["shareSummary"] },
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
    instructions: draft.consignas[0]?.text ?? "",
    material: draft.material.slice(0, ACTIVITY_LIMITS.material),
  };
  const dirtyTitles = [...SECTIONS.filter((s) => sectionDirty(s.keys)).map((s) => s.title), ...(dirtyKeys.includes("sectionTitles") ? ["Títulos"] : [])];
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useKeyboardOpen();
  const barShown = dirty && !keyboardOpen;
  useKeepFieldVisible(rootRef, barRef, barShown);

  return (
    // scroll-mb: fields brought into view (focus, scrollIntoView) stop above the save bar and the phone tab bar.
    <div ref={rootRef} className="lg:grid lg:grid-cols-[minmax(0,1fr)_190px] lg:gap-8 [&_input]:scroll-mb-44 [&_textarea]:scroll-mb-44 lg:[&_input]:scroll-mb-24 lg:[&_textarea]:scroll-mb-24">
      <div className="grid min-w-0 gap-4">
        {activity.status === "published" && activity.participants > 0 ? (
          <Notice tone="lilac" title="Esta actividad está en curso">
            Ya participaron {plural(activity.participants, "alumno", "alumnos")}. Lo que cambies se aplica desde que guardes; sus conversaciones, respuestas y
            evaluaciones se conservan. Si querés probar cambios grandes sin afectarlos, duplicala.
          </Notice>
        ) : null}
        {/* See it as the students do, or turn on a section that is off. */}
        <div className="flex flex-wrap items-center gap-2">
          <PreviewButton activity={activity} form={form} />
          <AddSectionMenu form={form} onGo={(id) => requestAnimationFrame(() => scrollToSection(id))} />
        </div>
        <EditorSection
          id="idioma"
          title="Idioma"
          description="Los alumnos ven sus pantallas, los botones de ayuda y las preguntas de cierre en este idioma, y el tutor les responde en él. Tus pantallas siguen en castellano."
          {...meta("idioma")}
        >
          <LanguageSwitch
            value={draft.language}
            onChange={(v) => {
              set("language", v);
              // Voice in the other language would not match: an English activity talks in English.
              if (v === "en" && draft.voiceLanguage === "es") set("voiceLanguage", "en");
              if (v === "es" && draft.voiceLanguage === "en") set("voiceLanguage", "es");
            }}
          />
          {draft.language === "en" ? (
            <p className="mt-3 text-[13px] leading-5 text-text-3">
              Escribí la consigna, el material y las preguntas en inglés: los alumnos los leen tal cual.
            </p>
          ) : null}
        </EditorSection>

        <EditorSection
          id="presentacion"
          title="Presentación"
          description="Una explicación general del desafío que los alumnos leen antes de empezar. Así queda claro dónde termina la presentación y empieza la actividad."
          {...meta("presentacion")}
        >
          <PresentationEditor form={form} />
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
            <Switch
              checked={draft.objectivesVisible}
              onCheckedChange={(v) => set("objectivesVisible", v)}
              label="Mostrar los objetivos a los alumnos"
              description={draft.objectivesVisible ? "Los leen junto a la actividad." : "Solo los usa el tutor: los alumnos no los ven."}
            />
          </div>
          {draft.objectivesVisible ? <StudentTitleFields form={form} section="objetivos" /> : null}
        </EditorSection>

        <EditorSection
          id="consigna"
          title="Consignas"
          description="Los alumnos ven una por vez, con «Anterior» y «Siguiente», y el tutor sabe en cuál están. Cada una puede pedir una respuesta escrita."
          {...meta("consigna")}
        >
          <div className="grid gap-5">
            <ModeSelector form={form} />
            <ConsignasEditor form={form} participants={activity.participants} />
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
          {draft.requireInitialAnswer ? <StudentTitleFields form={form} section="respuesta_inicial" /> : null}
        </EditorSection>

        <EditorSection id="respuesta-final" title="Respuesta final" {...meta("respuesta-final")}>
          <Switch
            checked={draft.askFinalAnswer}
            onCheckedChange={(v) => set("askFinalAnswer", v)}
            label="Pedir una respuesta final al terminar"
            description={
              draft.askFinalAnswer
                ? "Al terminar, cada alumno escribe su producción final respondiendo la pregunta de cierre."
                : "Al terminar, los alumnos pasan directo a la reflexión y la entrega, sin escribir una respuesta final."
            }
          />
          {draft.askFinalAnswer ? (
            <Field
              className="mt-4"
              label="Pregunta de cierre"
              optional
              hint={`Es lo que leen al terminar. Si la dejás vacía, dice «${DEFAULT_FINAL_QUESTION_BY_LANGUAGE[draft.language]}».`}
              error={errors.finalQuestion}
              counter={draft.finalQuestion.length > FINAL_QUESTION_MAX - 40 ? { value: draft.finalQuestion.length, max: FINAL_QUESTION_MAX } : undefined}
            >
              {(p) => (
                <Input
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.finalQuestion}
                  maxLength={FINAL_QUESTION_MAX}
                  onChange={(e) => set("finalQuestion", e.target.value)}
                  placeholder={DEFAULT_FINAL_QUESTION_BY_LANGUAGE[draft.language]}
                />
              )}
            </Field>
          ) : null}
          {draft.askFinalAnswer ? <StudentTitleFields form={form} section="respuesta_final" /> : null}
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
          <Switch
            checked={draft.askReflection}
            onCheckedChange={(v) => set("askReflection", v)}
            label="Pedir una reflexión al terminar"
            description={
              draft.askReflection
                ? "Al terminar, cada alumno responde todas estas preguntas antes de enviar su trabajo."
                : "Los alumnos no ven la reflexión. Las preguntas quedan guardadas por si la volvés a activar."
            }
          />
          {draft.askReflection ? (
            <div className="mt-5">
              <ReflectionEditor activityId={activity.id} form={form} context={aiContext} />
            </div>
          ) : null}
          {draft.askReflection ? <StudentTitleFields form={form} section="reflexion" /> : null}
        </EditorSection>

        <EditorSection
          id="mensaje-final"
          title="Mensaje final"
          description="Un mensaje o una indicación que los alumnos leen al terminar, sin tener que responder nada. Por ejemplo: «Con otro color, sumá una pregunta nueva a tus notas Cornell»."
          {...meta("mensaje-final")}
        >
          <Switch
            checked={draft.closingMessageOn}
            onCheckedChange={(v) => set("closingMessageOn", v)}
            label="Mostrar un mensaje al terminar"
            description={draft.closingMessageOn ? "Lo ven en el cierre y después de enviar su trabajo." : "No se muestra ningún mensaje al terminar."}
          />
          {draft.closingMessageOn ? (
            <Field
              className="mt-4"
              label="Mensaje"
              error={errors.closingMessage}
              counter={{ value: draft.closingMessage.length, max: CLOSING_MESSAGE_MAX }}
            >
              {(p) => (
                <Textarea
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.closingMessage}
                  maxLength={CLOSING_MESSAGE_MAX}
                  onChange={(e) => set("closingMessage", e.target.value)}
                  minRows={3}
                  placeholder="Ej.: Antes de irte, revisá tus notas y marcá con otro color lo que aprendiste hoy."
                />
              )}
            </Field>
          ) : null}
          {draft.closingMessageOn ? <StudentTitleFields form={form} section="cierre" /> : null}
        </EditorSection>

        <EditorSection
          id="entrega"
          title="Entrega (archivo o enlace)"
          description={
            <span className="flex items-start gap-1.5">
              <Paperclip className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
              Al terminar, cada alumno puede subir un PDF, un Word, un texto o una foto (hasta {MAX_DELIVERABLE_LABEL}), o pegar un enlace
              (Google Drive, Docs, Canva…). Lo ves en su trabajo y lo podés analizar con la rúbrica.
            </span>
          }
          {...meta("entrega")}
        >
          <RadioCards<DeliverableMode>
            name="deliverable-mode"
            legend="Pedir una entrega al terminar"
            value={draft.deliverableMode}
            onChange={(v) => set("deliverableMode", v)}
            options={(Object.keys(DELIVERABLE_MODES) as DeliverableMode[]).map((k) => ({
              value: k,
              label: DELIVERABLE_MODES[k].label,
              description: DELIVERABLE_MODES[k].description,
            }))}
          />
          {errors.deliverableMode ? <p className="mt-1.5 text-[13px] font-medium text-rose">{errors.deliverableMode}</p> : null}
          {draft.deliverableMode !== "off" ? (
            <Field
              className="mt-4"
              label="Qué tienen que entregar"
              optional
              hint="Lo leen los alumnos junto a los botones para subir el archivo o pegar el enlace."
              error={errors.deliverablePrompt}
              counter={{ value: draft.deliverablePrompt.length, max: DELIVERABLE_PROMPT_MAX }}
            >
              {(p) => (
                <Textarea
                  id={p.id}
                  aria-describedby={p.describedBy}
                  invalid={p.invalid}
                  value={draft.deliverablePrompt}
                  onChange={(e) => set("deliverablePrompt", e.target.value)}
                  minRows={2}
                  placeholder="Ej.: Una foto del barco que armaste, o el informe del experimento en PDF."
                />
              )}
            </Field>
          ) : null}
        </EditorSection>

        <EditorSection
          id="devolucion"
          title="Devolución de la IA"
          description="El resumen de la IA sobre el trabajo de cada alumno, con citas suyas y próximos pasos. Siempre lo ves vos en la Evaluación de cada alumno; acá decidís si también lo ven ellos."
          {...meta("devolucion")}
        >
          <Switch
            checked={draft.shareSummary}
            onCheckedChange={(v) => set("shareSummary", v)}
            label="Mostrar a cada alumno el resumen de su trabajo"
            description={
              draft.shareSummary
                ? "Al enviar su trabajo, cada alumno ve el resumen de la IA con sus citas y los próximos pasos. Si lo volvés a resumir en Evaluación, ve el nuevo."
                : "Solo vos ves el resumen de la IA, en la Evaluación de cada alumno."
            }
          />
          {draft.shareSummary && !defaultBasis({ rubric: draft.rubric, objectives: draft.objectives }).length ? (
            <Notice tone="amber" className="mt-4">
              Para armar el resumen, la actividad necesita objetivos o una rúbrica. Cargá alguno de los dos.
            </Notice>
          ) : null}
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


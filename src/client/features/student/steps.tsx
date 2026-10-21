// Initial answer, closing (final answer + reflection) and the completed / closed views.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, KeyRound, Lock } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Field, FormError, Textarea } from "@client/components/ui/field";
import { ApiError, errorMessage } from "@client/lib/api";
import {
  MAX_ANSWER_CHARS,
  MAX_REFLECTION_ANSWER_CHARS,
  MIN_ANSWER_CHARS,
  type StudentWorkspace,
} from "@shared/contracts/student";
import { setWorkspace, studentApi, studentKey } from "./api";
import { draftKey, useDraft, type DraftField } from "./hooks";
import { UnsentNotice } from "./entry";
import { ReadOnlyThread } from "./thread";
import { canSpeak, speechLang } from "./voice-support";

function useHeadingFocus(focus: boolean | undefined) {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return ref;
}

function useStaleHandler(token: string) {
  const qc = useQueryClient();
  return (err: unknown) => {
    if (err instanceof ApiError && ["unavailable", "no_session", "read_only"].includes(err.code)) {
      void qc.invalidateQueries({ queryKey: studentKey(token) });
    }
  };
}

// ── Step 1: initial answer ──

export function InitialAnswerStep({ token, workspace, focusHeading }: { token: string; workspace: StudentWorkspace; focusHeading?: boolean }) {
  const qc = useQueryClient();
  const onStale = useStaleHandler(token);
  const [answer, setAnswer, clear] = useDraft(draftKey(token, workspace.resumeCode, "initial"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useHeadingFocus(focusHeading);
  const length = answer.trim().length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || length < MIN_ANSWER_CHARS) return;
    setBusy(true);
    setError(null);
    try {
      const r = await studentApi.initial(token, answer.trim());
      clear();
      setWorkspace(qc, token, r.workspace);
    } catch (err) {
      onStale(err);
      setError(err instanceof ApiError ? (err.fields.answer ?? err.message) : errorMessage(err) || "No pudimos guardar tu respuesta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="initial-title" className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
      <p className="text-sm font-semibold text-lilac-ink">Antes de conversar</p>
      <h2 id="initial-title" ref={headingRef} tabIndex={-1} className="q-hang mt-2 text-[24px] leading-tight outline-none sm:text-[26px]">
        ¿Qué pensás vos?
      </h2>
      <p className="mt-3 text-[15px] leading-6 text-text-2">
        Escribí tu primera idea sobre la consigna, aunque no estés seguro. Cuando la guardes ya no se puede cambiar: al final vas a
        escribir tu respuesta mejorada.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field
          label="Tu primera idea"
          counter={length > MAX_ANSWER_CHARS - 400 ? { value: length, max: MAX_ANSWER_CHARS } : undefined}
          hint="Se guarda en este dispositivo mientras escribís, aunque cierres la página."
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              minRows={5}
              maxRows={14}
              placeholder="Yo creo que…"
            />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy} disabled={length < MIN_ANSWER_CHARS || length > MAX_ANSWER_CHARS}>
          Guardar y empezar a conversar
        </Button>
      </form>
    </section>
  );
}

// ── Closing: final answer + reflection ──

export function ClosingStep({
  token,
  workspace,
  onBack,
  focusHeading,
}: {
  token: string;
  workspace: StudentWorkspace;
  onBack: () => void;
  focusHeading?: boolean;
}) {
  const qc = useQueryClient();
  const onStale = useStaleHandler(token);
  const code = workspace.resumeCode;
  const [finalAnswer, setFinal, clearFinal] = useDraft(draftKey(token, code, "final"));
  const [reflectionRaw, setReflectionRaw, clearReflection] = useDraft(draftKey(token, code, "reflection"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const headingRef = useHeadingFocus(focusHeading);

  let reflection: Record<string, string> = {};
  try {
    reflection = reflectionRaw ? (JSON.parse(reflectionRaw) as Record<string, string>) : {};
  } catch {
    reflection = {};
  }
  const setAnswerFor = (key: string, value: string) => setReflectionRaw(JSON.stringify({ ...reflection, [key]: value }));

  // Tell the live view the student moved to the closing step (every time it opens).
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    studentApi.closing(token).catch(onStale);
  }, [token, onStale]);

  const length = finalAnswer.trim().length;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || length < MIN_ANSWER_CHARS) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await studentApi.finish(token, {
        finalAnswer: finalAnswer.trim(),
        reflection: workspace.activity.reflectionQuestions.map((q) => ({ key: q.key, answer: (reflection[q.key] ?? "").trim() })),
      });
      clearFinal();
      clearReflection();
      setWorkspace(qc, token, r.workspace);
    } catch (err) {
      onStale(err);
      if (err instanceof ApiError && Object.keys(err.fields).length) setFieldErrors(err.fields);
      setError(errorMessage(err) || "No pudimos enviar tu trabajo. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="closing-title" className="space-y-5">
      <Button variant="ghost" className="-ml-3 h-11" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>
        Volver a la conversación
      </Button>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
        <p className="text-sm font-semibold text-lilac-ink">Para terminar</p>
        <h2 id="closing-title" ref={headingRef} tabIndex={-1} className="q-hang mt-2 text-[24px] leading-tight outline-none sm:text-[26px]">
          ¿Qué pensás ahora?
        </h2>
        <p className="mt-3 text-[15px] leading-6 text-text-2">
          Escribí tu respuesta final con tus palabras y contá cómo lo pensaste. Cuando la envíes ya no vas a poder cambiarla, y tu docente
          va a poder leerla.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-6">
          {workspace.session.initialAnswer ? (
            <div className="rounded-md bg-sunken px-4 py-3">
              <p className="text-xs font-semibold text-text-3">Tu primera idea</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text-2">{workspace.session.initialAnswer}</p>
            </div>
          ) : null}

          <Field
            label="Tu respuesta final"
            hint="Se guarda en este dispositivo mientras escribís, aunque cierres la página."
            error={fieldErrors.finalAnswer}
            counter={length > MAX_ANSWER_CHARS - 400 ? { value: length, max: MAX_ANSWER_CHARS } : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={finalAnswer}
                onChange={(e) => setFinal(e.target.value)}
                minRows={5}
                placeholder="Ahora pienso que…"
              />
            )}
          </Field>

          {workspace.activity.reflectionQuestions.length ? (
            <fieldset className="space-y-4 border-t border-line pt-5">
              <legend className="float-left w-full font-display text-lg font-semibold text-ink">Tu reflexión</legend>
              <p className="clear-left pt-1 text-sm text-text-2">Contá cómo fue tu forma de pensar. Podés responder las que quieras.</p>
              {workspace.activity.reflectionQuestions.map((q, i) => {
                const v = reflection[q.key] ?? "";
                return (
                  <Field
                    key={q.key}
                    label={q.question}
                    optional
                    error={fieldErrors[`reflection.${i}.answer`]}
                    counter={v.length > MAX_REFLECTION_ANSWER_CHARS - 300 ? { value: v.trim().length, max: MAX_REFLECTION_ANSWER_CHARS } : undefined}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={v}
                        onChange={(e) => setAnswerFor(q.key, e.target.value)}
                        minRows={2}
                        maxRows={8}
                      />
                    )}
                  </Field>
                );
              })}
            </fieldset>
          ) : null}

          <FormError message={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="secondary" size="lg" onClick={onBack} disabled={busy}>
              Seguir conversando
            </Button>
            <Button type="submit" size="lg" loading={busy} disabled={length < MIN_ANSWER_CHARS || length > MAX_ANSWER_CHARS}>
              Enviar mi trabajo
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ── Completed / closed by the teacher ──

export function DoneStep({
  workspace,
  focusHeading,
  linkOpen = true,
  unsent = [],
}: {
  workspace: StudentWorkspace;
  focusHeading?: boolean;
  /** False when the teacher closed the link afterwards (the code cannot be used meanwhile). */
  linkOpen?: boolean;
  /** Text written on this device that never reached the server (session closed meanwhile). */
  unsent?: DraftField[];
}) {
  const ended = workspace.stage === "ended";
  const s = workspace.session;
  const headingRef = useHeadingFocus(focusHeading);
  const listenLang = workspace.activity.voiceLanguage !== "off" && canSpeak() ? speechLang(workspace.activity.voiceLanguage) : null;
  const answered = s.reflection.filter((r) => r.answer);

  return (
    <section aria-labelledby="done-title" className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
        {ended ? (
          <Lock className="size-8 text-lilac-ink" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-9 text-leaf" aria-hidden="true" />
        )}
        <h2 id="done-title" ref={headingRef} tabIndex={-1} className="mt-3 font-display text-[26px] leading-tight font-semibold text-ink outline-none">
          {ended ? "Tu docente cerró tu sesión" : "¡Terminaste la actividad!"}
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-text-2">
          {ended
            ? s.finalAnswer
              ? "Ya no se pueden agregar respuestas. Tu trabajo quedó guardado y tu docente lo puede ver."
              : "Ya no se pueden agregar respuestas. Lo que escribiste hasta acá quedó guardado y tu docente lo puede ver."
            : "Tu trabajo quedó guardado y tu docente lo puede ver."}
        </p>
        {ended ? <UnsentNotice fields={unsent} reopenable /> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {s.initialAnswer ? (
            <div className="rounded-md bg-sunken px-4 py-3.5">
              <p className="text-xs font-semibold text-text-3">Al empezar pensabas</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{s.initialAnswer}</p>
            </div>
          ) : null}
          {s.finalAnswer ? (
            <div className={s.initialAnswer ? "rounded-md bg-leaf-soft px-4 py-3.5" : "rounded-md bg-leaf-soft px-4 py-3.5 sm:col-span-2"}>
              <p className="text-xs font-semibold text-leaf">Ahora pensás</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{s.finalAnswer}</p>
            </div>
          ) : null}
        </div>

        {answered.length ? (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="font-display text-lg font-semibold text-ink">Tu reflexión</h3>
            <dl className="mt-3 space-y-3">
              {answered.map((r) => (
                <div key={r.key}>
                  <dt className="text-sm font-semibold text-text">{r.question}</dt>
                  <dd className="mt-0.5 text-[15px] leading-6 whitespace-pre-wrap text-text-2">{r.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <p className="mt-6 flex items-start gap-2.5 rounded-md bg-lilac-soft px-4 py-3 text-sm leading-6 text-lilac-ink">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Tu código es <strong className="font-mono text-[15px] tracking-[0.15em]">{workspace.resumeCode}</strong>. Con él podés volver a ver
            tu trabajo desde otro dispositivo{linkOpen ? "" : " cuando tu docente vuelva a abrir la actividad"}.
          </span>
        </p>
      </div>

      <details className="group rounded-xl border border-line bg-surface shadow-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
          Ver la conversación con el tutor
          <span className="text-sm font-normal text-text-3 group-open:hidden">Mostrar</span>
          <span className="hidden text-sm font-normal text-text-3 group-open:inline">Ocultar</span>
        </summary>
        <div className="border-t border-line px-5 py-5">
          <ReadOnlyThread messages={workspace.messages} initialAnswer={null} listenLang={listenLang} />
        </div>
      </details>
    </section>
  );
}

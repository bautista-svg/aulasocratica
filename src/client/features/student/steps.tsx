// Initial answer, closing (final answer + reflection) and the completed / closed views.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, KeyRound, Lock, MessageSquareText } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";
import { Field, FormError, Textarea } from "@client/components/ui/field";
import { ApiError } from "@client/lib/api";
import type { StudentWorkspace } from "@shared/contracts/student";
import { MAX_ANSWER_CHARS, MAX_REFLECTION_ANSWER_CHARS, MIN_ANSWER_CHARS } from "@shared/contracts/student-limits";
import { setWorkspace, studentApi, studentKey } from "./api";
import { draftKey, useDraft, type DraftField } from "./hooks";
import { UnsentNotice } from "./entry";
import { ReadOnlyThread } from "./thread";
import { canSpeak, speechLang } from "./voice-support";
import { DeliverableField, DeliverableFileLine } from "./deliverable";
import { useT } from "./i18n";
import { localAnswers } from "./consignas";

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
  const t = useT();
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
      setError(
        err instanceof ApiError
          ? err.fields.answer
            ? t.fieldError("answer", err.fields.answer)
            : t.error(err)
          : t.error(err) || t.steps.initialFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="initial-title" className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
      <p className="text-sm font-semibold text-lilac-ink">{t.steps.beforeChat}</p>
      <h2 id="initial-title" ref={headingRef} tabIndex={-1} className="q-hang mt-2 text-[24px] leading-tight outline-none sm:text-[26px]">
        {workspace.activity.sections.respuesta_inicial.title}
      </h2>
      <p className="mt-3 text-[15px] leading-6 text-text-2">{workspace.activity.sections.respuesta_inicial.subtitle}</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field
          label={t.steps.firstIdea}
          counter={length > MAX_ANSWER_CHARS - 400 ? { value: length, max: MAX_ANSWER_CHARS } : undefined}
          hint={t.steps.savedHint}
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
              placeholder={t.steps.initialPlaceholder}
            />
          )}
        </Field>
        <FormError message={error} />
        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy} disabled={length < MIN_ANSWER_CHARS || length > MAX_ANSWER_CHARS}>
          {t.steps.saveAndStart}
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
  onGoTo,
  focusHeading,
}: {
  token: string;
  workspace: StudentWorkspace;
  onBack: () => void;
  /** Go back to one consigna (to write a missing answer). */
  onGoTo: (index: number) => void;
  focusHeading?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const onStale = useStaleHandler(token);
  const code = workspace.resumeCode;
  const a = workspace.activity;
  const [finalAnswer, setFinal, clearFinal] = useDraft(draftKey(token, code, "final"));
  // The answers written in each consigna: this device's latest text first, else the saved one.
  const consignas = a.consignas;
  const local = localAnswers(token, code, consignas.map((c) => c.id));
  const answerOf = (id: string) => (local[id] ?? workspace.session.consignaAnswers[id] ?? "").trim();
  const asked = consignas.map((c, i) => ({ c, i })).filter(({ c }) => c.answer);
  const missing = asked.filter(({ c }) => answerOf(c.id).length < MIN_ANSWER_CHARS);
  const asks = a.askFinalAnswer;
  const [reflectionRaw, setReflectionRaw, clearReflection] = useDraft(draftKey(token, code, "reflection"));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const headingRef = useHeadingFocus(focusHeading);
  const asksFile = a.deliverableMode !== "off";
  const missingFile = a.deliverableMode === "required" && !workspace.deliverable;

  let reflection: Record<string, string> = {};
  try {
    reflection = reflectionRaw ? (JSON.parse(reflectionRaw) as Record<string, string>) : {};
  } catch {
    reflection = {};
  }
  const setAnswerFor = (key: string, value: string) => setReflectionRaw(JSON.stringify({ ...reflection, [key]: value }));
  // Every reflection question needs an answer before the work can be sent.
  const unanswered = a.reflectionQuestions.filter((q) => !(reflection[q.key] ?? "").trim()).length;

  // Tell the live view the student moved to the closing step (every time it opens).
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    studentApi.closing(token).catch(onStale);
  }, [token, onStale]);

  const length = finalAnswer.trim().length;
  const answered = missing.length === 0 && unanswered === 0 && (!asks || (length >= MIN_ANSWER_CHARS && length <= MAX_ANSWER_CHARS));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !answered) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const r = await studentApi.finish(token, {
        finalAnswer: asks ? finalAnswer.trim() : "",
        consignaAnswers: Object.fromEntries(asked.map(({ c }) => [c.id, answerOf(c.id)])),
        reflection: a.reflectionQuestions.map((q) => ({ key: q.key, answer: (reflection[q.key] ?? "").trim() })),
      });
      clearFinal();
      clearReflection();
      setWorkspace(qc, token, r.workspace);
    } catch (err) {
      onStale(err);
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setFieldErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t.fieldError(k, v)])));
      }
      setError(t.error(err) || t.steps.finishFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="closing-title" className="space-y-5">
      <Button variant="ghost" className="-ml-3 h-11" icon={<ArrowLeft className="size-4" />} onClick={onBack} disabled={busy}>
        {t.steps.backToChat}
      </Button>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
        <p className="text-sm font-semibold text-lilac-ink">{t.steps.toFinish}</p>
        <h2 id="closing-title" ref={headingRef} tabIndex={-1} className={cn("mt-2 text-[24px] leading-tight outline-none sm:text-[26px]", asks ? "q-hang" : "font-display font-semibold text-ink")}>
          {asks ? a.finalQuestion : t.steps.beforeSend}
        </h2>
        <p className="mt-3 text-[15px] leading-6 text-text-2">{asks ? a.sections.respuesta_final.subtitle : t.steps.closingIntro}</p>

        <form onSubmit={submit} className="mt-6 space-y-6">
          {workspace.session.initialAnswer ? (
            <div className="rounded-md bg-sunken px-4 py-3">
              <p className="text-xs font-semibold text-text-3">{t.steps.firstIdea}</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text-2">{workspace.session.initialAnswer}</p>
            </div>
          ) : null}

          {asked.length ? (
            <div>
              <h3 className="text-[15px] font-semibold text-text">{t.consigna.answersTitle}</h3>
              <ul className="mt-2 space-y-2">
                {asked.map(({ c, i }) => {
                  const text = answerOf(c.id);
                  const ok = text.length >= MIN_ANSWER_CHARS;
                  const err = fieldErrors[`consigna.${c.id}`];
                  return (
                    <li key={c.id} className={cn("rounded-lg border px-4 py-3", ok ? "border-line bg-paper/60" : "border-amber/40 bg-amber-soft/50")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-text">
                          {consignas.length > 1 ? `${i + 1}. ` : ""}
                          {c.title}
                        </p>
                        {ok ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-leaf">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" /> {t.consigna.answered}
                          </span>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => onGoTo(i)}>
                            {t.consigna.goTo}
                          </Button>
                        )}
                      </div>
                      {ok ? (
                        <p className="mt-1 line-clamp-3 text-sm leading-6 whitespace-pre-wrap text-text-2">{text}</p>
                      ) : (
                        <p className="mt-1 text-sm text-amber" role={err ? "alert" : undefined}>
                          {err || t.consigna.missing}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {asks ? (
            <Field
              label={a.sections.respuesta_final.title}
              hint={t.steps.savedHint}
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
                  placeholder={t.steps.finalPlaceholder}
                />
              )}
            </Field>
          ) : null}

          {a.closingMessage ? (
            <TeacherNote text={a.closingMessage} label={a.sections.cierre.title} subtitle={a.sections.cierre.subtitle} />
          ) : null}

          {a.reflectionQuestions.length ? (
            <fieldset className="space-y-4 border-t border-line pt-5">
              <legend className="float-left w-full font-display text-lg font-semibold text-ink">{a.sections.reflexion.title}</legend>
              <p className="clear-left pt-1 text-sm text-text-2">{a.sections.reflexion.subtitle}</p>
              {a.reflectionQuestions.map((q, i) => {
                const v = reflection[q.key] ?? "";
                return (
                  <Field
                    key={q.key}
                    label={q.question}
                    error={fieldErrors[`reflection.${i}.answer`]}
                    counter={v.length > MAX_REFLECTION_ANSWER_CHARS - 300 ? { value: v.trim().length, max: MAX_REFLECTION_ANSWER_CHARS } : undefined}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        aria-required="true"
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

          {asksFile ? <DeliverableField token={token} workspace={workspace} onBusyChange={setUploading} onStale={onStale} disabled={busy} /> : null}

          <FormError message={error} />
          {unanswered ? (
            <p id="falta-reflexion" className="text-sm font-medium text-text-2 sm:text-right">
              {t.steps.reflectionMissing(unanswered)}
            </p>
          ) : null}
          {missingFile ? (
            <p id="falta-entrega" className="text-sm font-medium text-text-2 sm:text-right">
              {t.steps.missingFile}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="secondary" size="lg" onClick={onBack} disabled={busy}>
              {t.steps.keepChatting}
            </Button>
            <Button
              type="submit"
              size="lg"
              loading={busy}
              aria-describedby={[unanswered ? "falta-reflexion" : "", missingFile ? "falta-entrega" : ""].filter(Boolean).join(" ") || undefined}
              disabled={!answered || missingFile || uploading}
            >
              {t.steps.sendWork}
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
  const t = useT();
  const ended = workspace.stage === "ended";
  const s = workspace.session;
  const headingRef = useHeadingFocus(focusHeading);
  const listenLang = workspace.activity.voiceLanguage !== "off" && canSpeak() ? speechLang(workspace.activity.voiceLanguage) : null;
  const answered = s.reflection.filter((r) => r.answer);
  const a = workspace.activity;
  // Answers written in each consigna (with its title); the final production is what follows them.
  const written = a.consignas.map((c, i) => ({ c, i, text: (s.consignaAnswers[c.id] ?? "").trim() })).filter((x) => x.c.answer && x.text);
  const production = !a.askFinalAnswer
    ? null
    : written.length
      ? (s.finalAnswer?.split(/\n\n(?:Producción final|Final work):\n/).at(-1) ?? null)
      : s.finalAnswer;

  return (
    <section aria-labelledby="done-title" className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
        {ended ? (
          <Lock className="size-8 text-lilac-ink" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-9 text-leaf" aria-hidden="true" />
        )}
        <h2 id="done-title" ref={headingRef} tabIndex={-1} className="mt-3 font-display text-[26px] leading-tight font-semibold text-ink outline-none">
          {ended ? t.done.endedTitle : t.done.doneTitle}
        </h2>
        <p className="mt-2 text-[15px] leading-6 text-text-2">
          {ended ? (s.finalAnswer ? t.done.endedWithAnswer : t.done.endedNoAnswer) : t.done.body}
        </p>
        {ended ? <UnsentNotice fields={unsent} reopenable /> : null}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {s.initialAnswer ? (
            <div className="rounded-md bg-sunken px-4 py-3.5">
              <p className="text-xs font-semibold text-text-3">{t.done.thoughtBefore}</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{s.initialAnswer}</p>
            </div>
          ) : null}
          {written.length ? (
            <div className="rounded-md bg-leaf-soft px-4 py-3.5 sm:col-span-2">
              <p className="text-xs font-semibold text-leaf">{t.consigna.answersTitle}</p>
              <ol className="mt-2 space-y-2.5">
                {written.map(({ c, i, text }) => (
                  <li key={c.id}>
                    <p className="text-xs font-semibold text-text-2">
                      {a.consignas.length > 1 ? `${i + 1}. ` : ""}
                      {c.title}
                    </p>
                    <p className="mt-0.5 text-[15px] leading-6 whitespace-pre-wrap text-text">{text}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : s.finalAnswers.filter(Boolean).length > 1 ? (
            <div className="rounded-md bg-leaf-soft px-4 py-3.5 sm:col-span-2">
              <p className="text-xs font-semibold text-leaf">{t.done.thinkNow}</p>
              <ol className="mt-2 space-y-2.5">
                {s.finalAnswers.map((ans, i) => (
                  <li key={i}>
                    <p className="text-xs font-semibold text-text-2">{t.done.taskN(i + 1)}</p>
                    <p className="mt-0.5 text-[15px] leading-6 whitespace-pre-wrap text-text">{ans}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {written.length && production ? (
            <div className="rounded-md bg-leaf-soft px-4 py-3.5 sm:col-span-2">
              <p className="text-xs font-semibold text-leaf">{a.sections.respuesta_final.title}</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{production}</p>
            </div>
          ) : !written.length && s.finalAnswers.filter(Boolean).length <= 1 && s.finalAnswer ? (
            <div className={s.initialAnswer ? "rounded-md bg-leaf-soft px-4 py-3.5" : "rounded-md bg-leaf-soft px-4 py-3.5 sm:col-span-2"}>
              <p className="text-xs font-semibold text-leaf">{t.done.thinkNow}</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{s.finalAnswer}</p>
            </div>
          ) : null}
        </div>

        {workspace.activity.closingMessage ? (
          <div className="mt-6">
            <TeacherNote text={workspace.activity.closingMessage} label={a.sections.cierre.title} subtitle={a.sections.cierre.subtitle} />
          </div>
        ) : null}

        {workspace.deliverable ? (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="font-display text-lg font-semibold text-ink">{t.done.deliverable}</h3>
            <div className="mt-3 rounded-md border border-line bg-paper px-4 py-3">
              <DeliverableFileLine file={workspace.deliverable} link={linkOpen} />
            </div>
          </div>
        ) : null}

        {answered.length ? (
          <div className="mt-6 border-t border-line pt-5">
            <h3 className="font-display text-lg font-semibold text-ink">{t.done.reflection}</h3>
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
            {t.done.codeLine((code) => <strong className="font-mono text-[15px] tracking-[0.15em]">{code}</strong>, workspace.resumeCode, linkOpen)}
          </span>
        </p>
      </div>

      <details className="group rounded-xl border border-line bg-surface shadow-1">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
          {t.done.seeChat}
          <span className="text-sm font-normal text-text-3 group-open:hidden">{t.done.show}</span>
          <span className="hidden text-sm font-normal text-text-3 group-open:inline">{t.done.hide}</span>
        </summary>
        <div className="border-t border-line px-5 py-5">
          <ReadOnlyThread messages={workspace.messages} initialAnswer={null} listenLang={listenLang} />
        </div>
      </details>
    </section>
  );
}

/** The teacher's message for the end: something to read, nothing to answer. */
function TeacherNote({ text, label, subtitle }: { text: string; label: string; subtitle?: string }) {
  return (
    <aside aria-label={label} className="flex gap-3 rounded-[14px] border border-lilac/40 bg-lilac-soft/60 px-4 py-3.5">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-lilac-ink shadow-1" aria-hidden="true">
        <MessageSquareText className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-lilac-ink uppercase">{label}</p>
        {subtitle ? <p className="mt-0.5 text-[13px] text-text-2">{subtitle}</p> : null}
        <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap text-text">{text}</p>
      </div>
    </aside>
  );
}

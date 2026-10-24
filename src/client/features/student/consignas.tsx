// One consigna at a time ("Consigna 2 de 4", Anterior / Siguiente), with its own written answer
// when the teacher asks for one: saved on the server as the student types (and kept on this
// device if that fails), editable until the work is sent. Also the presentation shown before
// starting, with «Comenzar actividad».
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, Target } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import type { StudentWorkspace } from "@shared/contracts/student";
import { MAX_ANSWER_CHARS } from "@shared/contracts/student-limits";
import { studentApi } from "./api";
import { useT } from "./i18n";

// ── Where the student is (this device remembers it) ──

const indexKey = (token: string, code: string) => `as-consigna:${token}:${code}`;

export function useConsignaIndex(token: string, code: string, total: number): [number, (i: number) => void] {
  const [index, setIndex] = useState(() => {
    try {
      const n = Number(localStorage.getItem(indexKey(token, code)));
      return Number.isInteger(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  });
  const set = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(total - 1, i));
      setIndex(next);
      try {
        localStorage.setItem(indexKey(token, code), String(next));
      } catch {
        /* private mode: only for this visit */
      }
    },
    [token, code, total],
  );
  return [Math.max(0, Math.min(total - 1, index)), set];
}

/** The presentation was read ("Comenzar actividad"): it is not shown again on this device. */
export const introKey = (token: string, code: string) => `as-intro:${token}:${code}`;

// ── The answer of one consigna ──

const backupKey = (token: string, code: string, id: string) => `as-answer:${token}:${code}:${id}`;

function readBackup(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The latest text of every consigna answer on this device (sent again when finishing). */
export function localAnswers(token: string, code: string, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const v = readBackup(backupKey(token, code, id));
    if (v !== null) out[id] = v;
  }
  return out;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

function AnswerBox({ token, code, consignaId, initial, label }: { token: string; code: string; consignaId: string; initial: string; label: string }) {
  const t = useT();
  const key = backupKey(token, code, consignaId);
  const [value, setValue] = useState(() => readBackup(key) ?? initial);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setState("saving");
    try {
      await studentApi.answer(token, consignaId, latest.current);
      setState("saved");
    } catch {
      setState("failed");
    }
  }, [token, consignaId]);
  // Leaving the consigna (or the page) saves what is pending.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void studentApi.answer(token, consignaId, latest.current).catch(() => {});
      }
    },
    [token, consignaId],
  );
  const id = `answer-${consignaId}`;
  return (
    <div className="mt-5">
      <label htmlFor={id} className="text-[15px] font-semibold text-text">
        {label}
      </label>
      <Textarea
        id={id}
        className="mt-1.5"
        value={value}
        maxLength={MAX_ANSWER_CHARS}
        minRows={4}
        maxRows={14}
        placeholder={t.consigna.answerPlaceholder}
        aria-describedby={`${id}-state`}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          latest.current = v;
          try {
            localStorage.setItem(key, v);
          } catch {
            /* ignore */
          }
          setState("idle");
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void saveNow(), 900);
        }}
        onBlur={() => {
          if (timer.current) void saveNow();
        }}
      />
      <p id={`${id}-state`} className={cn("mt-1.5 flex items-center gap-1.5 text-[13px]", state === "failed" ? "text-amber" : "text-text-3")} aria-live="polite">
        {state === "saved" ? <Check className="size-3.5 text-leaf" aria-hidden="true" /> : null}
        {state === "saving" ? t.consigna.saving : state === "saved" ? t.consigna.saved : state === "failed" ? t.consigna.saveFailed : t.consigna.answerHint}
      </p>
    </div>
  );
}

// ── The consigna card ──

export function ConsignaPanel({
  token,
  workspace,
  index,
  onIndex,
  onShowIntro,
}: {
  token: string;
  workspace: StudentWorkspace;
  index: number;
  onIndex: (i: number) => void;
  onShowIntro?: () => void;
}) {
  const t = useT();
  const list = workspace.activity.consignas;
  const c = list[index];
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    // Moving between consignas puts keyboard and screen-reader users on the new one.
    if (moved.current) headingRef.current?.focus({ preventScroll: false });
  }, [index]);
  if (!c) return null;
  const multi = list.length > 1;
  const go = (i: number) => {
    moved.current = true;
    onIndex(i);
  };
  const last = index === list.length - 1;
  return (
    <section aria-labelledby="consigna-now" className="mb-6 rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {multi ? (
          <p className="text-sm font-semibold text-lilac-ink">{t.consigna.progress(index + 1, list.length)}</p>
        ) : (
          <p className="text-sm font-semibold text-lilac-ink">{t.ws.taskTitle}</p>
        )}
        {onShowIntro ? (
          <button type="button" onClick={onShowIntro} className="-my-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink underline decoration-lilac underline-offset-4">
            <BookOpen className="size-4" aria-hidden="true" />
            {t.consigna.viewIntro}
          </button>
        ) : null}
      </div>
      {multi ? (
        <ol className="mt-3 flex gap-1.5" aria-label={t.consigna.tasksNav}>
          {list.map((x, i) => {
            const done = x.answer && (workspace.session.consignaAnswers[x.id] ?? "").trim().length > 0;
            return (
              <li key={x.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`${t.consigna.progress(i + 1, list.length)}: ${x.title}`}
                  className="group block w-full py-2"
                >
                  <span
                    className={cn(
                      "block h-1.5 rounded-full transition-colors",
                      i === index ? "bg-ink" : done || i < index ? "bg-leaf-bright" : "bg-sunken group-hover:bg-line-strong",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      <h2 id="consigna-now" ref={headingRef} tabIndex={-1} className="mt-3 font-display text-[22px] leading-tight font-semibold text-ink outline-none sm:text-[24px]">
        {c.title}
      </h2>
      <p className="mt-3 text-[16px] leading-7 whitespace-pre-wrap text-text">{c.text}</p>
      {c.answer ? (
        <AnswerBox
          key={c.id}
          token={token}
          code={workspace.resumeCode}
          consignaId={c.id}
          initial={workspace.session.consignaAnswers[c.id] ?? ""}
          label={t.consigna.yourAnswer}
        />
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-lilac-soft/60 px-3.5 py-2.5 text-sm leading-6 text-lilac-ink">
          <Target className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {last ? t.consigna.talkHintLast : t.consigna.talkHint}
        </p>
      )}
      {multi ? (
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="secondary" icon={<ArrowLeft className="size-4" />} disabled={index === 0} onClick={() => go(index - 1)}>
            {t.consigna.prev}
          </Button>
          <Button variant={last ? "secondary" : "primary"} disabled={last} onClick={() => go(index + 1)}>
            {t.consigna.next}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── Before starting: the presentation and the objectives ──

export function IntroStep({ workspace, started, onStart }: { workspace: StudentWorkspace; started: boolean; onStart: () => void }) {
  const t = useT();
  const a = workspace.activity;
  const ref = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <section aria-labelledby="intro-title" className="space-y-4">
      {a.presentation ? (
        <article className="rounded-xl border border-line bg-surface p-5 shadow-2 sm:p-7">
          <p className="text-sm font-semibold text-lilac-ink">{a.title}</p>
          <h2 id="intro-title" ref={ref} tabIndex={-1} className="mt-2 font-display text-[26px] leading-tight font-semibold text-ink outline-none sm:text-[30px]">
            {a.sections.presentacion.title}
          </h2>
          {a.sections.presentacion.subtitle ? <p className="mt-2 text-[15px] leading-6 text-text-2">{a.sections.presentacion.subtitle}</p> : null}
          <p className="mt-4 text-[16px] leading-7 whitespace-pre-wrap text-text">{a.presentation}</p>
        </article>
      ) : (
        <h2 id="intro-title" ref={ref} tabIndex={-1} className="sr-only">
          {a.title}
        </h2>
      )}
      {a.objectives ? (
        <article className="rounded-xl border border-line bg-surface p-5 shadow-1 sm:p-6">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Target className="size-5 text-lilac-ink" aria-hidden="true" />
            {a.sections.objetivos.title}
          </h3>
          {a.sections.objetivos.subtitle ? <p className="mt-1 text-sm text-text-2">{a.sections.objetivos.subtitle}</p> : null}
          <p className="mt-2 text-[15px] leading-7 whitespace-pre-wrap text-text">{a.objectives}</p>
        </article>
      ) : null}
      <div className="flex justify-end pt-1">
        <Button size="lg" className="w-full sm:w-auto" icon={started ? <ArrowLeft className="size-4" /> : undefined} onClick={onStart}>
          {started ? t.consigna.backToActivity : t.consigna.startActivity}
          {started ? null : <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
      </div>
    </section>
  );
}

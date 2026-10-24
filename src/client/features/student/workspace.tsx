// The student's workspace: compact header ("No soy <nombre>"), instructions and files,
// progress, and the current step (initial answer → tutor → closing → done). Also shown,
// read-only, when the teacher closed the link after this device's work was finished.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, ExternalLink, FileText, Image as ImageIcon, KeyRound, Lock, Music, X } from "lucide-react";
import { LogoMark } from "@client/components/brand/logo";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";
import type { StudentFile, StudentLinkInfo, StudentWorkspace } from "@shared/contracts/student";
import { studentApi, studentKey } from "./api";
import { clearDrafts, readFlag, unsentDrafts, useKeyboardInset, writeFlag } from "./hooks";
import { useIntegritySignals } from "./integrity";
import { ChatStep } from "./chat";
import { ClosingStep, DoneStep, InitialAnswerStep } from "./steps";
import { ConsignaPanel, IntroStep, introKey, useConsignaIndex } from "./consignas";
import { canDictate, stopSpeaking } from "./voice-support";
import { useT } from "./i18n";

type View = "intro" | "initial" | "tutor" | "closing" | "done";

const firstName = (name: string) => name.split(" ")[0] ?? name;

export function Workspace({ token, info }: { token: string; info: StudentLinkInfo & { workspace: StudentWorkspace } }) {
  const t = useT();
  const w = info.workspace;
  const qc = useQueryClient();
  useKeyboardInset();

  const closingKey = `as-closing:${token}:${w.resumeCode}`;
  const [closing, setClosingState] = useState(() => readFlag(closingKey));
  const setClosing = (on: boolean) => {
    writeFlag(closingKey, on);
    setClosingState(on);
  };
  // The presentation comes first (once: «Comenzar actividad»); it can be read again any time.
  const [started, setStartedState] = useState(() => readFlag(introKey(token, w.resumeCode)));
  const [rereading, setRereading] = useState(false);
  const start = () => {
    writeFlag(introKey(token, w.resumeCode), true);
    setStartedState(true);
    setRereading(false);
  };
  const [consigna, setConsigna] = useConsignaIndex(token, w.resumeCode, Math.max(1, w.activity.consignas.length));
  const working0 = w.stage === "initial" || w.stage === "tutor";
  const view: View =
    working0 && w.activity.presentation && (!started || rereading)
      ? "intro"
      : w.stage === "initial"
        ? "initial"
        : w.stage === "tutor"
          ? closing
            ? "closing"
            : "tutor"
          : "done";
  /** The link is closed but this finished work stays readable on this device. */
  const closedMessage = info.availability !== "available" ? t.availability(info.availability, info.message) : null;

  // Focus the new step's heading after a transition (not on the first render).
  const prevView = useRef<View>(view);
  const transitioned = prevView.current !== view;
  useEffect(() => {
    prevView.current = view;
  }, [view]);

  // On entering (after typing the name, or on a reload) keyboard and screen-reader users start
  // at the current step, not at the top of the page; the page itself does not scroll.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const id = { intro: "intro-title", initial: "initial-title", tutor: "consigna-now", closing: "closing-title", done: "done-title" }[view];
    document.getElementById(id)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finished work needs no drafts on this device; a session closed by the teacher keeps
  // them (it can be reopened) and says they were not sent.
  useEffect(() => {
    if (w.stage === "completed") clearDrafts(token, w.resumeCode);
  }, [w.stage, token, w.resumeCode]);
  const [unsent] = useState(() => (w.stage === "ended" ? unsentDrafts(token, w.resumeCode) : []));

  const working = view !== "done";
  const materialText = [w.activity.instructions, w.activity.objectives, w.activity.material].filter(Boolean).join("\n\n");
  useIntegritySignals({
    token,
    enabled: working,
    materialText,
    insideTexts: () => [
      ...w.messages.map((m) => m.content),
      w.session.initialAnswer ?? "",
      ...Array.from(document.querySelectorAll("textarea")).map((el) => el.value),
    ],
  });

  const [isNew, setIsNew] = useState(() => readFlag(`as-new:${token}:${w.resumeCode}`));
  const showNewCode = isNew && working;
  const dismissNew = () => {
    writeFlag(`as-new:${token}:${w.resumeCode}`, false);
    setIsNew(false);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <Header token={token} workspace={w} onLeft={() => qc.setQueryData(studentKey(token), { ...info, workspace: null })} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-2 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-10 lg:pt-8">
        {/* On a phone the presentation comes first: the side card waits until the activity starts. */}
        <aside className={cn("space-y-4 lg:sticky lg:top-22 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-4", view === "intro" && "max-lg:hidden")}>
          <Progress workspace={w} view={view} />
          <InstructionsCard
            key={view === "initial" ? "initial" : "rest"}
            workspace={w}
            defaultOpen={view === "initial"}
            onShowIntro={working && w.activity.presentation && view !== "intro" ? () => setRereading(true) : undefined}
            footer={
              working ? (
                <>
                  <IntegrityNote voice={w.activity.voiceLanguage !== "off" && canDictate()} />
                  {showNewCode ? null : (
                    <CodeCard code={w.resumeCode} className="mt-2 border-0 bg-transparent px-0 py-0 shadow-none lg:hidden" />
                  )}
                </>
              ) : null
            }
          />
          {w.files.length ? <FilesCard files={w.files} /> : null}
          {working && !showNewCode ? <CodeCard code={w.resumeCode} className="hidden lg:flex" /> : null}
        </aside>

        <main id="contenido" className="mt-6 min-w-0 lg:mt-0">
          {closedMessage ? (
            <p role="status" className="mb-5 flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-[15px] leading-6 text-text shadow-1">
              <Lock className="mt-1 size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
              <span>
                <strong className="font-semibold">{closedMessage}</strong> {t.ws.closedStill}
              </span>
            </p>
          ) : null}
          {/* Answer first: on the first step the code notice goes below the form (phones). */}
          {showNewCode && view !== "initial" ? <NewCodeNotice code={w.resumeCode} onDismiss={dismissNew} /> : null}
          {view === "intro" ? <IntroStep workspace={w} started={started} onStart={start} /> : null}
          {view === "initial" && w.activity.consignas[0] ? <ConsignaGlance workspace={w} /> : null}
          {view === "initial" ? <InitialAnswerStep token={token} workspace={w} focusHeading={transitioned} /> : null}
          {showNewCode && view === "initial" ? <NewCodeNotice code={w.resumeCode} onDismiss={dismissNew} className="mt-5 mb-0" /> : null}
          {view === "tutor" ? (
            <ConsignaPanel
              token={token}
              workspace={w}
              index={consigna}
              onIndex={setConsigna}
              onShowIntro={w.activity.presentation ? () => setRereading(true) : undefined}
            />
          ) : null}
          {view === "tutor" ? <ChatStep token={token} workspace={w} consigna={consigna} onFinish={() => setClosing(true)} focusHeading={transitioned} /> : null}
          {view === "closing" ? (
            <ClosingStep
              token={token}
              workspace={w}
              onBack={() => setClosing(false)}
              onGoTo={(i) => {
                setConsigna(i);
                setClosing(false);
              }}
              focusHeading
            />
          ) : null}
          {view === "done" ? <DoneStep workspace={w} focusHeading={transitioned} linkOpen={!closedMessage} unsent={unsent} /> : null}
        </main>
      </div>
    </div>
  );
}

function Header({ token, workspace, onLeft }: { token: string; workspace: StudentWorkspace; onLeft: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const name = firstName(workspace.studentName);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await studentApi.leave(token);
      stopSpeaking();
      clearDrafts(token);
      onLeft();
      void qc.invalidateQueries({ queryKey: studentKey(token) });
    } catch {
      setError(t.ws.leaveFailed);
      setBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <LogoMark className="size-8 shrink-0 max-[359px]:hidden" />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate font-display text-[16px] font-semibold text-ink">{workspace.activity.title}</h1>
          <p className="truncate text-[13px] text-text-3">
            <span className="sr-only">{t.ws.workingAs}</span>
            {workspace.studentName}
          </p>
        </div>
        <Button
          ref={triggerRef}
          variant="ghost"
          className="h-11 max-w-[42%] shrink-0 px-3 text-sm"
          aria-expanded={open}
          aria-controls="leave-panel"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="truncate">{t.ws.notMe(name)}</span>
        </Button>
      </div>
      {open ? (
        <div id="leave-panel" role="region" aria-label={t.ws.leaveLabel} className="border-t border-line bg-amber-soft/60">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <p className="text-[15px] leading-6 text-text">
              {t.ws.leaveBody((s) => <strong className="font-semibold">{s}</strong>, workspace.studentName, name)}
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm font-medium text-rose">
                {error}
              </p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button ref={confirmRef} loading={busy} onClick={() => void leave()}>
                {t.ws.leaveConfirm}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {t.ws.cancel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Progress({ workspace, view }: { workspace: StudentWorkspace; view: View }) {
  const t = useT();
  const steps = workspace.activity.requireInitialAnswer || workspace.session.initialAnswer
    ? (["initial", "tutor", "closing"] as const)
    : (["tutor", "closing"] as const);
  const labels = t.ws.steps;
  const currentIdx = view === "done" ? -1 : steps.indexOf(view as never);
  // Finished steps; a session closed by the teacher may lack the final answer.
  const isDone = (s: (typeof steps)[number], i: number) =>
    view === "done"
      ? s === "initial"
        ? Boolean(workspace.session.initialAnswer)
        : s === "tutor"
          ? workspace.messages.length > 0
          : Boolean(workspace.session.finalAnswer)
      : i < currentIdx;
  return (
    <nav aria-label={t.ws.progressLabel} className="rounded-lg border border-line bg-surface px-4 pt-3 pb-2.5 shadow-1">
      <ol className="flex gap-2">
        {steps.map((s, i) => {
          const done = isDone(s, i);
          const current = i === currentIdx;
          return (
            <li key={s} className="min-w-0 flex-1" aria-current={current ? "step" : undefined}>
              <span
                className={cn("block h-1.5 rounded-full", done ? "bg-leaf-bright" : current ? "bg-ink" : "bg-sunken")}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "mt-1.5 flex items-center gap-1 truncate text-[13px]",
                  current ? "font-semibold text-ink" : done ? "text-text-2" : "text-text-3",
                )}
              >
                {done ? <Check className="size-3.5 shrink-0 text-leaf" strokeWidth={3} aria-hidden="true" /> : null}
                <span className="sr-only">{t.ws.stepSr(i + 1, steps.length, done ? "done" : current ? "current" : null)}</span>
                {labels[s]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function InstructionsCard({
  workspace,
  defaultOpen,
  footer,
  onShowIntro,
}: {
  workspace: StudentWorkspace;
  defaultOpen: boolean;
  footer?: ReactNode;
  onShowIntro?: () => void;
}) {
  const t = useT();
  const a = workspace.activity;
  const [desktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [open, setOpen] = useState(defaultOpen || desktop);
  const [materialOpen, setMaterialOpen] = useState(false);
  const hasMore = Boolean(a.objectives || a.material || footer);
  // The consigna itself is in the main column, one at a time; this card keeps the rest at hand.
  const multi = a.consignas.length > 1;

  return (
    <section aria-labelledby="consigna-title" className="rounded-lg border border-line bg-surface shadow-1">
      <div className="px-4 pt-4 pb-3">
        <h2 id="consigna-title" className="text-xs font-bold tracking-wide text-lilac-ink uppercase">
          {multi ? t.ws.tasksTitle(a.consignas.length) : t.ws.taskTitle}
        </h2>
        <ol className={cn("mt-2 space-y-1.5", !open && "max-h-16 overflow-hidden")}>
          {a.consignas.map((c, i) => (
            <li key={c.id} className="flex gap-2.5 text-sm leading-6 text-text">
              {multi ? (
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-lilac-soft text-[11px] font-bold text-lilac-ink tabular" aria-hidden="true">
                  {i + 1}
                </span>
              ) : null}
              <span className="min-w-0 font-semibold">{c.title}</span>
            </li>
          ))}
        </ol>
        {onShowIntro ? (
          <button type="button" onClick={onShowIntro} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink underline decoration-lilac underline-offset-4">
            {t.consigna.viewIntro}
          </button>
        ) : null}
        {open && a.objectives ? (
          <div className="mt-3">
            <h3 className="text-xs font-bold tracking-wide text-text-3 uppercase">{a.sections.objetivos.title}</h3>
            {a.sections.objetivos.subtitle ? <p className="mt-0.5 text-[13px] text-text-3">{a.sections.objetivos.subtitle}</p> : null}
            <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-text-2">{a.objectives}</p>
          </div>
        ) : null}
        {open && a.material ? (
          <div className="mt-3 rounded-md border border-line">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm font-semibold text-ink"
              aria-expanded={materialOpen}
              onClick={() => setMaterialOpen((o) => !o)}
            >
              {t.ws.material}
              <ChevronDown className={cn("size-4 text-text-3 transition-transform", materialOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {materialOpen ? (
              <div className="max-h-80 overflow-y-auto border-t border-line px-3 py-3 text-sm leading-6 whitespace-pre-wrap text-text">{a.material}</div>
            ) : null}
          </div>
        ) : null}
        {open && footer ? <div className="mt-4 border-t border-line pt-3">{footer}</div> : null}
      </div>
      {hasMore || !open ? (
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-line text-sm font-semibold text-lilac-ink lg:hidden"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t.ws.showLess : t.ws.showAllTasks}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

/** Files of the activity. On phones they start folded (one row) so the answer comes first. */
function FilesCard({ files }: { files: StudentFile[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const title = t.ws.filesTitleCount(files.length);
  return (
    <section aria-labelledby="files-title" className="rounded-lg border border-line bg-surface shadow-1" data-activity-material>
      <h2 id="files-title" className="hidden px-4 pt-4 text-xs font-bold tracking-wide text-lilac-ink uppercase lg:block">
        {t.ws.filesTitle}
      </h2>
      <h2 className="lg:hidden">
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-xs font-bold tracking-wide text-lilac-ink uppercase"
          aria-expanded={open}
          aria-controls="files-list"
          onClick={() => setOpen((o) => !o)}
        >
          {title}
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      <ul id="files-list" className={cn("divide-y divide-line px-4 pb-2 lg:mt-2", !open && "max-lg:hidden", open && "max-lg:border-t max-lg:border-line")}>
        {files.map((f) => {
          const Icon = f.kind === "image" ? ImageIcon : f.kind === "audio" ? Music : FileText;
          return (
            <li key={f.id} className="py-2.5">
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{f.name}</p>
                  <p className="text-xs text-text-3">{t.ws.size(f.sizeBytes)}</p>
                </div>
                {f.kind !== "audio" ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken"
                    aria-label={t.ws.openFile(f.name)}
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                ) : null}
                <a
                  href={`${f.url}?download=1`}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken"
                  aria-label={t.ws.downloadFile(f.name)}
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              </div>
              {f.kind === "audio" ? (
                <audio controls preload="none" src={f.url} className="mt-2 w-full">
                  {t.ws.audioUnsupported}
                </audio>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CodeCard({ code, className }: { code: string; className?: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 shadow-1", className)}>
      <KeyRound className="size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-text-2">
        {t.ws.codeCard}{" "}
        {shown ? <strong className="font-mono text-[15px] tracking-[0.15em] text-ink">{code}</strong> : null}
      </p>
      <Button variant="ghost" size="sm" className="h-11 shrink-0" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
        {shown ? t.ws.hide : t.ws.show}
      </Button>
    </div>
  );
}

function NewCodeNotice({ code, onDismiss, className }: { code: string; onDismiss: () => void; className?: string }) {
  const t = useT();
  return (
    <div role="status" className={cn("mb-5 flex items-start gap-3 rounded-lg border border-lilac/40 bg-lilac-soft px-4 py-3.5", className)}>
      <KeyRound className="mt-0.5 size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[15px] leading-6 text-lilac-ink">
        <p>
          {t.ws.yourCodeIs}
          <strong className="font-mono text-[17px] tracking-[0.18em]">{code}</strong>
        </p>
        <p className="text-sm">{t.ws.writeItDown}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-lilac-ink hover:bg-white/50"
        aria-label={t.ws.dismissCode}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function IntegrityNote({ voice }: { voice: boolean }) {
  const t = useT();
  return (
    <div className="space-y-2 text-[13px] leading-5 text-text-3">
      <p>{t.ws.integrity}</p>
      {voice ? <p>{t.ws.voicePrivacy}</p> : null}
    </div>
  );
}

/** Before the first answer: the first consigna, so the student knows what it is about. */
function ConsignaGlance({ workspace }: { workspace: StudentWorkspace }) {
  const t = useT();
  const c = workspace.activity.consignas[0]!;
  const n = workspace.activity.consignas.length;
  return (
    <section aria-label={c.title} className="mb-5 rounded-xl border border-line bg-surface px-5 py-4 shadow-1">
      <p className="text-sm font-semibold text-lilac-ink">{n > 1 ? t.consigna.progress(1, n) : t.ws.taskTitle}</p>
      <p className="mt-1 font-display text-lg font-semibold text-ink">{c.title}</p>
      <p className="mt-1.5 text-[15px] leading-6 whitespace-pre-wrap text-text">{c.text}</p>
    </section>
  );
}

// The student's workspace: compact header ("No soy <nombre>"), instructions and files,
// progress, and the current step (initial answer → tutor → closing → done).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Download, ExternalLink, FileText, Image as ImageIcon, KeyRound, Music, X } from "lucide-react";
import { LogoMark } from "@client/components/brand/logo";
import { Button } from "@client/components/ui/button";
import { cn } from "@client/lib/cn";
import type { StudentFile, StudentLinkInfo, StudentWorkspace } from "@shared/contracts/student";
import { studentApi, studentKey } from "./api";
import { clearDrafts, readFlag, useKeyboardInset, writeFlag } from "./hooks";
import { useIntegritySignals } from "./integrity";
import { ChatStep } from "./chat";
import { ClosingStep, DoneStep, InitialAnswerStep } from "./steps";
import { canDictate, stopSpeaking } from "./voice-support";

type View = "initial" | "tutor" | "closing" | "done";

const firstName = (name: string) => name.split(" ")[0] ?? name;

export function Workspace({ token, info }: { token: string; info: StudentLinkInfo & { workspace: StudentWorkspace } }) {
  const w = info.workspace;
  const qc = useQueryClient();
  useKeyboardInset();

  const closingKey = `as-closing:${token}:${w.resumeCode}`;
  const [closing, setClosingState] = useState(() => readFlag(closingKey));
  const setClosing = (on: boolean) => {
    writeFlag(closingKey, on);
    setClosingState(on);
  };
  const view: View =
    w.stage === "initial" ? "initial" : w.stage === "tutor" ? (closing ? "closing" : "tutor") : "done";

  // Focus the new step's heading after a transition (not on the first render).
  const prevView = useRef<View>(view);
  const transitioned = prevView.current !== view;
  useEffect(() => {
    prevView.current = view;
  }, [view]);

  const working = view !== "done";
  const materialText = [w.activity.instructions, w.activity.objectives, w.activity.material].filter(Boolean).join("\n\n");
  useIntegritySignals({
    token,
    enabled: working,
    materialText,
    insideTexts: () => [
      ...w.messages.map((m) => m.content),
      w.session.initialAnswer ?? "",
      ...Array.from(document.querySelectorAll("textarea")).map((t) => t.value),
    ],
  });

  const [isNew, setIsNew] = useState(() => readFlag(`as-new:${token}:${w.resumeCode}`));
  const dismissNew = () => {
    writeFlag(`as-new:${token}:${w.resumeCode}`, false);
    setIsNew(false);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <Header token={token} workspace={w} onLeft={() => qc.setQueryData(studentKey(token), { ...info, workspace: null })} />
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-2 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-10 lg:pt-8">
        <aside className="space-y-4 lg:sticky lg:top-22 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-4">
          <Progress workspace={w} view={view} />
          <InstructionsCard
            key={view === "initial" ? "initial" : "rest"}
            workspace={w}
            defaultOpen={view === "initial"}
            footer={
              working ? (
                <>
                  <IntegrityNote voice={w.activity.voiceLanguage !== "off" && canDictate()} />
                  <CodeCard code={w.resumeCode} className="mt-2 border-0 bg-transparent px-0 py-0 shadow-none lg:hidden" />
                </>
              ) : null
            }
          />
          {w.files.length ? <FilesCard files={w.files} /> : null}
          {working ? <CodeCard code={w.resumeCode} className="hidden lg:flex" /> : null}
        </aside>

        <main id="contenido" className="mt-6 min-w-0 lg:mt-0">
          {isNew && working ? <NewCodeNotice code={w.resumeCode} onDismiss={dismissNew} /> : null}
          {view === "initial" ? <InitialAnswerStep token={token} workspace={w} focusHeading={transitioned} /> : null}
          {view === "tutor" ? <ChatStep token={token} workspace={w} onFinish={() => setClosing(true)} focusHeading={transitioned} /> : null}
          {view === "closing" ? <ClosingStep token={token} workspace={w} onBack={() => setClosing(false)} focusHeading /> : null}
          {view === "done" ? <DoneStep workspace={w} focusHeading={transitioned} /> : null}
        </main>
      </div>
    </div>
  );
}

function Header({ token, workspace, onLeft }: { token: string; workspace: StudentWorkspace; onLeft: () => void }) {
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
      setError("No pudimos cerrar la sesión. Revisá tu conexión y probá de nuevo.");
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
            <span className="sr-only">Trabajando como </span>
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
          <span className="truncate">No soy {name}</span>
        </Button>
      </div>
      {open ? (
        <div id="leave-panel" role="region" aria-label="Salir de este dispositivo" className="border-t border-line bg-amber-soft/60">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <p className="text-[15px] leading-6 text-text">
              ¿No sos <strong className="font-semibold">{workspace.studentName}</strong>? Vamos a cerrar su sesión en este dispositivo para que
              entres con tu nombre. Su trabajo queda guardado; para volver a entrar como {name} hace falta su código.
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm font-medium text-rose">
                {error}
              </p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button ref={confirmRef} loading={busy} onClick={() => void leave()}>
                Salir de este dispositivo
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Progress({ workspace, view }: { workspace: StudentWorkspace; view: View }) {
  const steps = workspace.activity.requireInitialAnswer || workspace.session.initialAnswer
    ? (["initial", "tutor", "closing"] as const)
    : (["tutor", "closing"] as const);
  const labels: Record<string, string> = { initial: "Tu idea", tutor: "Conversación", closing: "Cierre" };
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
    <nav aria-label="Progreso de la actividad" className="rounded-lg border border-line bg-surface px-4 pt-3 pb-2.5 shadow-1">
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
                <span className="sr-only">
                  Paso {i + 1} de {steps.length}
                  {done ? " (hecho)" : current ? " (actual)" : ""}:{" "}
                </span>
                {labels[s]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function InstructionsCard({ workspace, defaultOpen, footer }: { workspace: StudentWorkspace; defaultOpen: boolean; footer?: ReactNode }) {
  const a = workspace.activity;
  const [desktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [open, setOpen] = useState(defaultOpen || desktop);
  const [materialOpen, setMaterialOpen] = useState(false);
  const hasMore = Boolean(a.objectives || a.material || footer || a.instructions.length > 180);
  const instructions = a.instructions.trim() || "Tu docente no escribió una consigna: conversá con el tutor sobre el tema de la actividad.";

  return (
    <section aria-labelledby="consigna-title" className="rounded-lg border border-line bg-surface shadow-1">
      <div className="px-4 pt-4 pb-3">
        <h2 id="consigna-title" className="text-xs font-bold tracking-wide text-lilac-ink uppercase">
          Consigna
        </h2>
        <p className={cn("mt-1.5 text-[15px] leading-6 whitespace-pre-wrap text-text", !open && "line-clamp-3")}>{instructions}</p>
        {open && a.objectives ? (
          <div className="mt-3">
            <h3 className="text-xs font-bold tracking-wide text-text-3 uppercase">Lo que vas a aprender</h3>
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
              Material para leer
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
          {open ? "Mostrar menos" : "Ver la consigna completa"}
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

const sizeLabel = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

function FilesCard({ files }: { files: StudentFile[] }) {
  return (
    <section aria-labelledby="files-title" className="rounded-lg border border-line bg-surface px-4 py-4 shadow-1" data-activity-material>
      <h2 id="files-title" className="text-xs font-bold tracking-wide text-lilac-ink uppercase">
        Archivos de la actividad
      </h2>
      <ul className="mt-2 divide-y divide-line">
        {files.map((f) => {
          const Icon = f.kind === "image" ? ImageIcon : f.kind === "audio" ? Music : FileText;
          return (
            <li key={f.id} className="py-2.5">
              <div className="flex items-center gap-2.5">
                <Icon className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">{f.name}</p>
                  <p className="text-xs text-text-3">{sizeLabel(f.sizeBytes)}</p>
                </div>
                {f.kind !== "audio" ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken"
                    aria-label={`Abrir ${f.name} (se abre en otra pestaña)`}
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                ) : null}
                <a
                  href={`${f.url}?download=1`}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken"
                  aria-label={`Descargar ${f.name}`}
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              </div>
              {f.kind === "audio" ? (
                <audio controls preload="none" src={f.url} className="mt-2 w-full">
                  Tu navegador no puede reproducir este audio. Descargalo con el botón de al lado.
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
  const [shown, setShown] = useState(false);
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 shadow-1", className)}>
      <KeyRound className="size-4 shrink-0 text-lilac-ink" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-text-2">
        Tu código para seguir en otro dispositivo:{" "}
        {shown ? <strong className="font-mono text-[15px] tracking-[0.15em] text-ink">{code}</strong> : null}
      </p>
      <Button variant="ghost" size="sm" className="h-11 shrink-0" onClick={() => setShown((s) => !s)} aria-pressed={shown}>
        {shown ? "Ocultar" : "Ver"}
      </Button>
    </div>
  );
}

function NewCodeNotice({ code, onDismiss }: { code: string; onDismiss: () => void }) {
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-lg border border-lilac/40 bg-lilac-soft px-4 py-3.5">
      <KeyRound className="mt-0.5 size-5 shrink-0 text-lilac-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[15px] leading-6 text-lilac-ink">
        <p>
          Tu código es <strong className="font-mono text-[17px] tracking-[0.18em]">{code}</strong>
        </p>
        <p className="text-sm">Anotalo: lo vas a necesitar si querés seguir en otro dispositivo. Tu docente también lo tiene.</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="-mt-1.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-lilac-ink hover:bg-white/50"
        aria-label="Ya lo anoté, cerrar aviso"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function IntegrityNote({ voice }: { voice: boolean }) {
  return (
    <div className="space-y-2 text-[13px] leading-5 text-text-3">
      <p>Mientras trabajás se registra si pegás texto copiado de afuera o si salís de esta página por un rato, y tu docente lo puede ver.</p>
      {voice ? (
        <p>
          El dictado lo hace tu navegador: el audio puede procesarse en servidores de Google o Apple para pasarlo a texto. Aula Socrática no
          guarda audio, solo el texto que enviás.
        </p>
      ) : null}
    </div>
  );
}

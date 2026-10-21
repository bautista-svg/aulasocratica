// The conversation with the tutor: thread, help buttons and a composer that never loses
// what the student typed (Enter sends, Shift+Enter is a new line; while the tutor answers,
// typing continues but sending waits; on any error the text stays).
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Flag, RotateCcw } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import { Spinner } from "@client/components/ui/spinner";
import { ApiError } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import type { ChatInput, StudentMessage, StudentWorkspace } from "@shared/contracts/student";
import { MAX_CHAT_CHARS } from "@shared/contracts/student-limits";
import { STUDENT_INTENTS, type StudentIntent } from "@shared/domain/pedagogy";
import { MAX_VOICE_SECONDS, speakableText } from "@shared/domain/voice";
import { appendMessages, streamChat, studentKey } from "./api";
import { draftKey, useDraft } from "./hooks";
import { StudentMessageBubble, TutorMessage } from "./thread";
import { canDictate, canSpeak, speechLang, stopSpeaking } from "./voice-support";
import type { DictationStatus } from "./voice";

const DictationButton = lazy(() => import("./voice").then((m) => ({ default: m.DictationButton })));

interface Overlay {
  userText: string | null;
  userMessageId: string | null;
  inputMode: "text" | "voice";
  intent: StudentIntent | null;
  reply: string;
  phase: "sending" | "thinking" | "streaming";
}

const INTENT_ORDER: StudentIntent[] = ["hint", "not_understood", "example", "review", "other_idea", "explain"];
const PREFILL: StudentIntent[] = ["other_idea", "explain"];
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function ChatStep({
  token,
  workspace,
  onFinish,
  focusHeading,
}: {
  token: string;
  workspace: StudentWorkspace;
  onFinish: () => void;
  focusHeading?: boolean;
}) {
  const qc = useQueryClient();
  const voice = workspace.activity.voiceLanguage;
  const lang = speechLang(voice);
  const [dictationOk] = useState(() => voice !== "off" && canDictate());
  const [readingOk] = useState(() => voice !== "off" && canSpeak());

  const [draft, setDraft, clearDraft] = useDraft(draftKey(token, workspace.resumeCode, "chat"));
  const [inputMode, setInputMode] = useState<"text" | "voice">("text");
  const [pendingIntent, setPendingIntent] = useState<StudentIntent | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [stopKey, setStopKey] = useState(0);
  const [dictation, setDictation] = useState<DictationStatus>({ listening: false, seconds: 0, error: null });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottom = useRef(true);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // Guards against a double Enter/tap before React re-renders.
  const inFlight = useRef(false);
  const busy = overlay !== null;

  const serverMessages = overlay?.userMessageId
    ? workspace.messages.filter((m) => m.id !== overlay.userMessageId)
    : workspace.messages;
  const last = workspace.messages.at(-1);
  const awaiting = !overlay && last?.role === "user";
  const lastAssistantId = [...serverMessages].reverse().find((m) => m.role === "assistant")?.id;

  // Follow the conversation while the student is at the bottom of the page.
  useEffect(() => {
    const onScroll = () => {
      nearBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Scrolling to the very end keeps the sticky composer at its natural place (never over the
  // latest message or the "Terminar" row).
  const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight });
  useLayoutEffect(() => {
    if (nearBottom.current) toBottom();
  }, [serverMessages.length, overlay?.reply, overlay?.phase, awaiting]);
  // On first mount returning students land on the latest message; after a step change the
  // heading gets the focus so screen readers announce where they are.
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    else if (workspace.messages.length) toBottom();
  }, []);

  const run = useCallback(
    async (body: ChatInput, restore: { text: string; intent: StudentIntent | null; mode: "text" | "voice" } | null) => {
      let started = false;
      let userMessageId: string | null = null;
      const createdAt = new Date().toISOString();
      const userMessage = (): StudentMessage[] =>
        userMessageId && body.text
          ? [
              {
                id: userMessageId,
                role: "user",
                content: body.text,
                intent: body.intent ?? null,
                inputMode: body.inputMode ?? "text",
                createdAt,
              },
            ]
          : [];
      try {
        await streamChat(token, body, {
          onStart: (id) => {
            started = true;
            userMessageId = id;
            setOverlay((o) => (o ? { ...o, userMessageId: id, phase: "thinking" } : o));
          },
          onDelta: (d) => setOverlay((o) => (o ? { ...o, reply: o.reply + d, phase: "streaming" } : o)),
          onDone: ({ messageId, text }) => {
            appendMessages(qc, token, [
              ...userMessage(),
              { id: messageId, role: "assistant", content: text, intent: null, inputMode: "text", createdAt: new Date().toISOString() },
            ]);
            setOverlay(null);
            setAnnounce(`El tutor respondió: ${speakableText(text)}`);
          },
          onError: ({ message }) => {
            appendMessages(qc, token, userMessage());
            setOverlay(null);
            setChatError(message);
          },
        });
      } catch (err) {
        setOverlay(null);
        if (!started) {
          // Refused or never reached the server: nothing was saved, the text goes back to the composer.
          if (restore) {
            setDraft((prev) => (prev.trim() ? `${restore.text}\n\n${prev}` : restore.text));
            if (restore.intent) setPendingIntent(restore.intent);
            setInputMode(restore.mode);
          }
          if (err instanceof ApiError && ["unavailable", "no_session", "read_only", "initial_required"].includes(err.code)) {
            void qc.invalidateQueries({ queryKey: studentKey(token) });
          }
          setSendError(err instanceof ApiError ? (err.fields.text ?? err.message) : "No pudimos enviar tu mensaje. Probá de nuevo.");
        } else {
          // The message was saved; the reply was cut. The retry button asks again.
          appendMessages(qc, token, userMessage());
          setChatError("Se cortó la conexión mientras el tutor respondía.");
        }
      } finally {
        inFlight.current = false;
        void qc.invalidateQueries({ queryKey: studentKey(token) });
      }
    },
    [qc, setDraft, token],
  );

  function send(text: string, intent: StudentIntent | null, mode: "text" | "voice", fromComposer: boolean) {
    const t = text.trim();
    if (!t || busy || inFlight.current) return false;
    if (t.length > MAX_CHAT_CHARS) {
      setSendError(`Tu mensaje puede tener hasta ${MAX_CHAT_CHARS} caracteres. Acortalo un poco.`);
      return false;
    }
    stopSpeaking();
    setStopKey((k) => k + 1);
    setSendError(null);
    setChatError(null);
    nearBottom.current = true;
    inFlight.current = true;
    setOverlay({ userText: t, userMessageId: null, inputMode: mode, intent, reply: "", phase: "sending" });
    void run({ text: t, intent, inputMode: mode }, fromComposer ? { text, intent, mode } : null);
    return true;
  }

  function submitComposer() {
    if (busy || !draft.trim()) return;
    const prefix = pendingIntent ? STUDENT_INTENTS[pendingIntent].message : null;
    const intent = pendingIntent && prefix && draft.trim().startsWith(prefix) ? pendingIntent : null;
    if (send(draft, intent, inputMode, true)) {
      clearDraft();
      setPendingIntent(null);
      setInputMode("text");
    }
  }

  function retry() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    stopSpeaking();
    setChatError(null);
    setSendError(null);
    nearBottom.current = true;
    setOverlay({ userText: null, userMessageId: null, inputMode: "text", intent: null, reply: "", phase: "sending" });
    void run({ retry: true }, null);
  }

  function pickIntent(k: StudentIntent) {
    const def = STUDENT_INTENTS[k];
    if (PREFILL.includes(k)) {
      setDraft((prev) => (prev.trim().startsWith(def.message) ? prev : `${def.message} ${prev.trim()}`.trimEnd() + " "));
      setPendingIntent(k);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      return;
    }
    send(def.message, k, "text", false);
  }

  const emptyText = workspace.session.initialAnswer
    ? "Ya guardaste tu primera idea. Contale al tutor cómo llegaste a ella, o pedile que la revise con vos."
    : "Contale al tutor qué pensás de la consigna o qué duda tenés. Te va a responder con preguntas para ayudarte a pensar.";
  const subtitle =
    voice === "en" && dictationOk
      ? "Practicá inglés: podés escribir o dictar tus mensajes."
      : dictationOk
        ? "Podés escribirle o dictarle con el micrófono."
        : "Te ayuda a pensar con preguntas, sin darte la respuesta.";
  const nothingYet = serverMessages.length === 0 && !overlay;

  return (
    <section aria-labelledby="chat-title" className="flex min-h-full flex-col">
      <header className="mb-5">
        <h2 id="chat-title" ref={headingRef} tabIndex={-1} className="font-display text-xl font-semibold text-ink outline-none">
          Conversación con el tutor
        </h2>
        <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>
      </header>

      <ol className="flex-1 space-y-6" aria-label="Mensajes">
        {workspace.session.initialAnswer ? (
          <li>
            <StudentMessageBubble text={workspace.session.initialAnswer} label="Tu primera idea" />
          </li>
        ) : null}
        {nothingYet ? (
          <li className="rounded-lg border border-dashed border-line-strong bg-surface/70 px-5 py-5 text-[15px] leading-6 text-text-2">
            {emptyText} Si te trabás, usá los botones de ayuda de abajo.
          </li>
        ) : null}
        {serverMessages.map((m) => (
          <li key={m.id}>
            {m.role === "assistant" ? (
              <TutorMessage
                text={m.content}
                current={m.id === lastAssistantId && !overlay && !awaiting}
                listen={readingOk ? { id: m.id, lang } : null}
              />
            ) : (
              <StudentMessageBubble text={m.content} voice={m.inputMode === "voice"} />
            )}
          </li>
        ))}
        {overlay?.userText ? (
          <li>
            <StudentMessageBubble text={overlay.userText} voice={overlay.inputMode === "voice"} />
          </li>
        ) : null}
        {overlay ? (
          <li>
            <TutorMessage text={overlay.reply} thinking={!overlay.reply} streaming={Boolean(overlay.reply)} />
          </li>
        ) : null}
        {awaiting ? (
          <li>
            {workspace.replyPending ? (
              <p className="flex items-center gap-2 pl-10 text-[15px] text-text-2">
                <Spinner className="size-4 text-lilac-ink" /> El tutor está terminando de responder…
              </p>
            ) : (
              <div role="alert" className="ml-10 rounded-lg border border-rose/20 bg-rose-soft/60 px-4 py-3">
                <p className="text-[15px] leading-6 text-text">{chatError ?? "El tutor no llegó a responder tu último mensaje."}</p>
                <Button variant="secondary" size="sm" className="mt-2.5 h-11" icon={<RotateCcw className="size-4" />} onClick={retry}>
                  Reintentar
                </Button>
              </div>
            )}
          </li>
        ) : null}
      </ol>

      <div className="mt-8 flex flex-col items-start gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-2">
          {nothingYet
            ? "Cuando quieras terminar, vas a escribir tu respuesta final y una reflexión."
            : "¿Ya sabés qué responder? Cuando quieras, terminá y escribí tu respuesta final."}
        </p>
        <Button variant="secondary" className="h-11 shrink-0" icon={<Flag className="size-4" />} disabled={busy} onClick={onFinish}>
          Terminar
        </Button>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      <div
        className="sticky z-20 -mx-4 mt-4 bg-gradient-to-t from-paper from-75% to-paper/0 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),12px)] lg:mx-0 lg:px-0"
        style={{ bottom: "var(--kb, 0px)" }}
      >
        <div role="group" aria-label="Pedile ayuda al tutor" className="relative -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
          {INTENT_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              disabled={busy}
              onClick={() => pickIntent(k)}
              className="inline-flex h-11 shrink-0 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium whitespace-nowrap text-ink shadow-1 transition-colors hover:border-lilac-ink/50 hover:bg-lilac-soft disabled:opacity-50"
            >
              {STUDENT_INTENTS[k].label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitComposer();
          }}
          className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2 transition-[border-color,box-shadow] focus-within:border-lilac-ink focus-within:ring-4 focus-within:ring-lilac/20"
        >
          <label htmlFor="composer" className="sr-only">
            Tu mensaje para el tutor
          </label>
          <Textarea
            id="composer"
            ref={textareaRef}
            value={draft}
            minRows={1}
            maxRows={6}
            enterKeyHint="send"
            placeholder={busy ? "Podés ir escribiendo…" : "Escribí tu respuesta o tu duda…"}
            aria-describedby="composer-help"
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v);
              if (dictation.listening) setStopKey((k) => k + 1);
              if (pendingIntent && !v.trim().startsWith(STUDENT_INTENTS[pendingIntent].message)) setPendingIntent(null);
              if (!v.trim()) setInputMode("text");
              if (sendError) setSendError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitComposer();
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent px-2.5 shadow-none hover:border-0 focus:ring-0"
          />
          {dictationOk ? (
            <Suspense fallback={<span className="size-11 shrink-0" />}>
              <DictationButton
                lang={lang}
                disabled={busy}
                stopKey={stopKey}
                getBase={() => textareaRef.current?.value ?? draft}
                onTranscript={(t) => {
                  setDraft(t);
                  setInputMode("voice");
                }}
                onStatus={setDictation}
              />
            </Suspense>
          ) : null}
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label={busy ? "Esperá a que el tutor termine de responder" : "Enviar"}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-ink text-white shadow-1 transition-colors hover:bg-ink-hover disabled:bg-line-strong disabled:text-white"
          >
            {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-5" aria-hidden="true" />}
          </button>
        </form>

        <div id="composer-help" className="mt-1.5 min-h-5 px-1 text-[13px] leading-5" aria-live="polite">
          {sendError ? (
            <p className="font-medium text-rose" role="alert">
              {sendError}
            </p>
          ) : dictation.listening ? (
            <p className="text-rose">
              Escuchando… {fmtSec(dictation.seconds)} / {fmtSec(MAX_VOICE_SECONDS)}. Revisá el texto antes de enviarlo.
            </p>
          ) : dictation.error ? (
            <p className="text-rose">{dictation.error}</p>
          ) : draft.length > MAX_CHAT_CHARS - 300 ? (
            <p className={cn("tabular", draft.trim().length > MAX_CHAT_CHARS ? "font-medium text-rose" : "text-text-3")}>
              {draft.trim().length}/{MAX_CHAT_CHARS} caracteres
            </p>
          ) : (
            <p className="hidden text-text-3 sm:block">Enter envía · Shift + Enter hace un salto de línea</p>
          )}
        </div>
      </div>
    </section>
  );
}

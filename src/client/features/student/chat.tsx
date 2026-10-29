// The conversation with the tutor: thread, help buttons and a composer that never loses
// what the student typed (Enter sends, Shift+Enter is a new line; while the tutor answers,
// typing continues but sending waits; on any error the text stays).
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Flag, MessageCircleCheck, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import { Spinner } from "@client/components/ui/spinner";
import { ApiError } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import type { ChatInput, StudentMessage, StudentWorkspace } from "@shared/contracts/student";
import { MAX_CHAT_CHARS } from "@shared/contracts/student-limits";
import type { StudentIntent } from "@shared/domain/pedagogy";
import { intentText } from "@shared/domain/language";
import { MAX_VOICE_SECONDS, speakableText } from "@shared/domain/voice";
import { appendMessages, streamChat, studentKey, updateWorkspace } from "./api";
import { draftKey, studentScroller, useDraft } from "./hooks";
import { StudentMessageBubble, TutorMessage } from "./thread";
import { canDictate, canSpeak, speechLang, stopSpeaking } from "./voice-support";
import type { DictationStatus } from "./voice";
import { useStudentLang, useT } from "./i18n";

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
  consigna,
  onFinish,
  focusHeading,
}: {
  token: string;
  workspace: StudentWorkspace;
  /** The consigna the student is on: the tutor accompanies that one. */
  consigna?: number;
  onFinish: () => void;
  focusHeading?: boolean;
}) {
  const consignaRef = useRef(consigna);
  consignaRef.current = consigna;
  const qc = useQueryClient();
  const t = useT();
  const uiLang = useStudentLang();
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
  // Starts false: a student who just entered stays at the top, where the consigna is; following
  // the conversation starts with their first message (or, returning, at the latest one).
  const nearBottom = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  // Guards against a double Enter/tap before React re-renders.
  const inFlight = useRef(false);
  const busy = overlay !== null;
  const done = overlay ? null : workspace.tutorDone;

  const serverMessages = overlay?.userMessageId
    ? workspace.messages.filter((m) => m.id !== overlay.userMessageId)
    : workspace.messages;
  const last = workspace.messages.at(-1);
  const awaiting = !overlay && last?.role === "user";
  const lastAssistantId = [...serverMessages].reverse().find((m) => m.role === "assistant")?.id;

  // Follow the conversation while the student is at the bottom: on every new message and
  // streamed piece of the reply, and when the visible area changes size (the keyboard opens or
  // closes, the composer grows). The page scrolls inside the workspace box, not the window.
  useEffect(() => {
    const el = studentScroller();
    if (!el) return;
    const onScroll = () => {
      nearBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 160;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    const resized = new ResizeObserver(() => {
      if (nearBottom.current) toBottom();
    });
    resized.observe(el);
    if (composerRef.current) resized.observe(composerRef.current);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resized.disconnect();
    };
  }, []);
  // Scrolling to the very end keeps the sticky composer at its natural place (never over the
  // latest message or the "Terminar" row).
  const toBottom = () => {
    const el = studentScroller();
    if (el) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    if (nearBottom.current) toBottom();
  }, [serverMessages.length, overlay?.reply, overlay?.phase, awaiting]);
  // On first mount returning students land on the latest message; after a step change the
  // heading gets the focus so screen readers announce where they are.
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    else if (workspace.messages.length) {
      nearBottom.current = true;
      toBottom();
    }
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
        await streamChat(token, consignaRef.current !== undefined ? { ...body, consigna: consignaRef.current } : body, {
          onStart: (id) => {
            started = true;
            userMessageId = id;
            setOverlay((o) => (o ? { ...o, userMessageId: id, phase: "thinking" } : o));
          },
          onDelta: (d) => setOverlay((o) => (o ? { ...o, reply: o.reply + d, phase: "streaming" } : o)),
          onDone: ({ messageId, text, tutorDone }) => {
            appendMessages(qc, token, [
              ...userMessage(),
              { id: messageId, role: "assistant", content: text, intent: null, inputMode: "text", createdAt: new Date().toISOString() },
            ]);
            if (tutorDone) updateWorkspace(qc, token, (w) => ({ ...w, tutorDone }));
            setOverlay(null);
            setAnnounce(t.chat.tutorReplied(speakableText(text)));
          },
          onError: (e) => {
            appendMessages(qc, token, userMessage());
            setOverlay(null);
            setChatError(t.streamError(e));
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
          if (err instanceof ApiError && ["unavailable", "no_session", "read_only", "initial_required", "tutor_done"].includes(err.code)) {
            void qc.invalidateQueries({ queryKey: studentKey(token) });
          }
          setSendError(
            err instanceof ApiError ? (err.fields.text ? t.fieldError("text", err.fields.text) : t.error(err)) : t.chat.sendFailed,
          );
        } else {
          // The message was saved; the reply was cut. The retry button asks again.
          appendMessages(qc, token, userMessage());
          setChatError(t.chat.replyCut);
        }
      } finally {
        inFlight.current = false;
        void qc.invalidateQueries({ queryKey: studentKey(token) });
      }
    },
    [qc, setDraft, token, t],
  );

  function send(text: string, intent: StudentIntent | null, mode: "text" | "voice", fromComposer: boolean) {
    const clean = text.trim();
    if (!clean || busy || inFlight.current) return false;
    if (clean.length > MAX_CHAT_CHARS) {
      setSendError(t.chat.tooLong(MAX_CHAT_CHARS));
      return false;
    }
    stopSpeaking();
    setStopKey((k) => k + 1);
    setSendError(null);
    setChatError(null);
    nearBottom.current = true;
    inFlight.current = true;
    setOverlay({ userText: clean, userMessageId: null, inputMode: mode, intent, reply: "", phase: "sending" });
    void run({ text: clean, intent, inputMode: mode }, fromComposer ? { text, intent, mode } : null);
    return true;
  }

  function submitComposer() {
    if (busy || !draft.trim()) return;
    const prefix = pendingIntent ? intentText(pendingIntent, uiLang).message : null;
    const intent = pendingIntent && prefix && draft.trim().startsWith(prefix) ? pendingIntent : null;
    if (send(draft, intent, inputMode, true)) {
      clearDraft();
      setPendingIntent(null);
      setInputMode("text");
      // On a phone the keyboard goes down after sending, so the reply has the whole screen.
      if (window.matchMedia("(pointer: coarse)").matches) textareaRef.current?.blur();
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
    const def = intentText(k, uiLang);
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

  const emptyText = workspace.session.initialAnswer ? t.chat.emptyWithIdea : t.chat.emptyNoIdea;
  const subtitle = voice === "en" && dictationOk ? t.chat.subtitlePractice : dictationOk ? t.chat.subtitleDictation : t.chat.subtitle;
  const nothingYet = serverMessages.length === 0 && !overlay;

  return (
    <section aria-labelledby="chat-title" className="flex min-h-full flex-col">
      <header className="mb-5">
        <h2 id="chat-title" ref={headingRef} tabIndex={-1} className="font-display text-xl font-semibold text-ink outline-none">
          {t.chat.title}
        </h2>
        <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>
      </header>

      <ol className="flex-1 space-y-6" aria-label={t.chat.messagesLabel}>
        {workspace.session.initialAnswer ? (
          <li>
            <StudentMessageBubble text={workspace.session.initialAnswer} label={t.thread.firstIdea} />
          </li>
        ) : null}
        {nothingYet ? (
          <li className="rounded-lg border border-dashed border-line-strong bg-surface/70 px-5 py-5 text-[15px] leading-6 text-text-2">
            {emptyText} {t.chat.stuck}
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
                <Spinner className="size-4 text-lilac-ink" /> {t.chat.finishing}
              </p>
            ) : (
              <div role="alert" className="ml-10 rounded-lg border border-rose/20 bg-rose-soft/60 px-4 py-3">
                <p className="text-[15px] leading-6 text-text">{chatError ?? t.chat.noReply}</p>
                <Button variant="secondary" size="sm" className="mt-2.5 h-11" icon={<RotateCcw className="size-4" />} onClick={retry}>
                  {t.chat.retry}
                </Button>
              </div>
            )}
          </li>
        ) : null}
      </ol>

      {done ? null : (
        <div className="mt-8 flex flex-col items-start gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-text-2">
            {!workspace.activity.askFinalAnswer ? t.chat.finishHintNoAnswer : nothingYet ? t.chat.finishHintEmpty : t.chat.finishHint}
          </p>
          <Button variant="secondary" className="h-11 shrink-0" icon={<Flag className="size-4" />} disabled={busy} onClick={onFinish}>
            {t.chat.finish}
          </Button>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      {/* Sticky at the bottom of the workspace box, which ends right above the keyboard. While the
          keyboard is up for another field (the consigna's answer) it stays in place, out of the way. */}
      <div
        ref={composerRef}
        data-composer
        className="sticky bottom-0 z-20 -mx-4 mt-4 bg-gradient-to-t from-paper from-75% to-paper/0 px-4 pt-5 pb-[max(env(safe-area-inset-bottom),12px)] max-lg:typing:pt-3 max-lg:typing:pb-2 max-lg:typing-other:static lg:mx-0 lg:px-0"
      >
        {done ? (
          // The tutor stopped asking (the teacher's limit, or the objectives shown): no composer, only the way out.
          <div role="status" className="flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-4 shadow-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className={cn(
                  "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
                  done === "achieved" ? "bg-leaf-soft text-leaf" : "bg-lilac-soft text-lilac-ink",
                )}
                aria-hidden="true"
              >
                {done === "achieved" ? <Sparkles className="size-5" /> : <MessageCircleCheck className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[17px] leading-6 font-semibold text-ink">{done === "achieved" ? t.chat.doneAchieved : t.chat.doneLimit}</p>
                <p className="mt-0.5 text-sm leading-5 text-text-2">{t.chat.doneNext(workspace.activity.askFinalAnswer)}</p>
              </div>
            </div>
            <Button className="h-11 w-full shrink-0 sm:w-auto" icon={<Flag className="size-4" />} onClick={onFinish}>
              {t.chat.finish}
            </Button>
          </div>
        ) : (
          <>
          <div
            role="group"
            aria-label={t.chat.helpLabel}
            className="relative -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] max-lg:typing:hidden lg:mx-0 lg:flex-wrap lg:px-0"
          >
            {INTENT_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => pickIntent(k)}
                className="inline-flex h-11 shrink-0 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium whitespace-nowrap text-ink shadow-1 transition-colors hover:border-lilac-ink/50 hover:bg-lilac-soft disabled:opacity-50"
              >
                {intentText(k, uiLang).label}
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
              {t.chat.composerLabel}
            </label>
            <Textarea
              id="composer"
              ref={textareaRef}
              value={draft}
              minRows={1}
              maxRows={6}
              enterKeyHint="send"
              placeholder={busy ? t.chat.placeholderBusy : t.chat.placeholder}
              aria-describedby="composer-help"
              onChange={(e) => {
                const v = e.target.value;
                setDraft(v);
                if (dictation.listening) setStopKey((k) => k + 1);
                if (pendingIntent && !v.trim().startsWith(intentText(pendingIntent, uiLang).message)) setPendingIntent(null);
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
                  onTranscript={(text) => {
                    setDraft(text);
                    setInputMode("voice");
                  }}
                  onStatus={setDictation}
                />
              </Suspense>
            ) : null}
            <button
              type="submit"
              // Keeps the focus in the composer while it sends (a phone then closes the keyboard itself).
              onMouseDown={(e) => e.preventDefault()}
              disabled={busy || !draft.trim()}
              aria-label={busy ? t.chat.sendWait : t.chat.send}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-ink text-white shadow-1 transition-colors hover:bg-ink-hover disabled:bg-line-strong disabled:text-white"
            >
              {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-5" aria-hidden="true" />}
            </button>
          </form>

          <div id="composer-help" className="mt-1.5 min-h-5 px-1 text-[13px] leading-5 max-sm:min-h-0" aria-live="polite">
            {sendError ? (
              <p className="font-medium text-rose" role="alert">
                {sendError}
              </p>
            ) : dictation.listening ? (
              <p className="text-rose">{t.chat.listening(fmtSec(dictation.seconds), fmtSec(MAX_VOICE_SECONDS))}</p>
            ) : dictation.error ? (
              <p className="text-rose">{dictation.error}</p>
            ) : draft.length > MAX_CHAT_CHARS - 300 ? (
              <p className={cn("tabular", draft.trim().length > MAX_CHAT_CHARS ? "font-medium text-rose" : "text-text-3")}>
                {t.chat.charCount(draft.trim().length, MAX_CHAT_CHARS)}
              </p>
            ) : (
              <p className="hidden text-text-3 sm:block">{t.chat.enterHint}</p>
            )}
          </div>
          </>
        )}
      </div>
    </section>
  );
}

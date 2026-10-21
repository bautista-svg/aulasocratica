// Conversation pieces shared by the live chat and the read-only views.
import { Suspense, lazy, memo, type ReactNode } from "react";
import { Mic } from "lucide-react";
import { LogoMark } from "@client/components/brand/logo";
import { cn } from "@client/lib/cn";
import type { StudentMessage } from "@shared/contracts/student";
import { Markdown } from "./markdown";

const ListenButton = lazy(() => import("./voice").then((m) => ({ default: m.ListenButton })));

interface TutorMessageProps {
  text: string;
  /** Latest reply: its closing question gets the hanging "?" signature. */
  current?: boolean;
  streaming?: boolean;
  thinking?: boolean;
  listen?: { id: string; lang: string } | null;
}

// Messages are memoized: the chat re-renders on every keystroke in the composer and on every
// streamed chunk, and only the message that changed has to render (and parse its Markdown) again.
export const TutorMessage = memo(
  TutorMessageView,
  (a, b) =>
    a.text === b.text &&
    a.current === b.current &&
    a.streaming === b.streaming &&
    a.thinking === b.thinking &&
    a.listen?.id === b.listen?.id &&
    a.listen?.lang === b.listen?.lang,
);

function TutorMessageView({ text, current, streaming, thinking, listen }: TutorMessageProps) {
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="sr-only">El tutor dice:</p>
        {thinking ? (
          <p className="flex h-7 items-center gap-1.5 text-[15px] text-text-3">
            El tutor está pensando
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac" aria-hidden="true" />
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac [animation-delay:200ms]" aria-hidden="true" />
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac [animation-delay:400ms]" aria-hidden="true" />
          </p>
        ) : (
          <div className="text-[16px] leading-7 text-text">
            <Markdown
              text={text}
              highlightQuestion={current && !streaming}
              trailing={streaming ? <span className="animate-caret ml-0.5 inline-block h-5 w-[2px] translate-y-1 bg-lilac-ink" aria-hidden="true" /> : null}
            />
          </div>
        )}
        {listen && !streaming && !thinking ? (
          <Suspense fallback={null}>
            <ListenButton id={listen.id} text={text} lang={listen.lang} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

export const StudentMessageBubble = memo(function StudentMessageBubble({
  text,
  voice,
  label,
  className,
}: {
  text: string;
  voice?: boolean;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-end", className)}>
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-ink-soft px-4 py-2.5 text-[16px] leading-7 text-ink sm:max-w-[80%]">
        <p className="sr-only">Vos:</p>
        {label ? <p className="mb-0.5 text-xs font-semibold text-lilac-ink">{label}</p> : null}
        <p className="break-words whitespace-pre-wrap">{text}</p>
        {voice ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-text-3">
            <Mic className="size-3" aria-hidden="true" /> Dictado
          </p>
        ) : null}
      </div>
    </div>
  );
});

/** The whole conversation, without composer (completed or closed sessions). */
export function ReadOnlyThread({
  messages,
  initialAnswer,
  listenLang,
}: {
  messages: StudentMessage[];
  initialAnswer: string | null;
  listenLang: string | null;
}) {
  if (!messages.length && !initialAnswer) {
    return <p className="text-[15px] text-text-2">No hubo conversación con el tutor.</p>;
  }
  return (
    <ol className="space-y-6">
      {initialAnswer ? (
        <li>
          <StudentMessageBubble text={initialAnswer} label="Tu primera idea" />
        </li>
      ) : null}
      {messages.map((m) => (
        <li key={m.id}>
          {m.role === "assistant" ? (
            <TutorMessage text={m.content} listen={listenLang ? { id: m.id, lang: listenLang } : null} />
          ) : (
            <StudentMessageBubble text={m.content} voice={m.inputMode === "voice"} />
          )}
        </li>
      ))}
    </ol>
  );
}

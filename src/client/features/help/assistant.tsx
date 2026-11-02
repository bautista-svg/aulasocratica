// "¿Dónde está…?": ask where something is; the answer names the place and "Llevame" goes there and
// lights up the button (the same layer as the guided tours). The conversation lives only here.
import { useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import * as RD from "@radix-ui/react-dialog";
import { ArrowRight, ArrowUp, RotateCcw, Sparkles, X } from "lucide-react";
import { api, errorMessage } from "@client/lib/api";
import { cn } from "@client/lib/cn";
import { pointAt } from "@client/components/app/tour";
import { helpPlace, resolvePlace, type HelpPlace } from "@shared/domain/help-places";
import { HELP_QUESTION_MAX, type HelpAnswer } from "@shared/contracts/help";
import { closeHelp, useHelpState } from "./store";

type Turn = { role: "user"; text: string } | { role: "assistant"; text: string; place: HelpPlace | null };

const SUGGESTIONS = [
  "¿Cómo creo un aula?",
  "¿Dónde comparto el enlace con mis alumnos?",
  "¿Dónde veo a mis alumnos trabajando?",
  "¿Cómo pongo el modo oscuro?",
];

export default function HelpAssistant() {
  const { open, question } = useHelpState();
  return (
    <RD.Root open={open} onOpenChange={(o) => (o ? undefined : closeHelp())} modal={false}>
      <RD.Portal>
        <RD.Content
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden border border-line bg-surface shadow-pop outline-none data-[state=open]:animate-rise",
            "inset-x-0 bottom-0 h-[78dvh] rounded-t-xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:h-[min(580px,calc(100dvh-40px))] sm:w-[380px] sm:rounded-xl",
          )}
        >
          {open ? <Conversation initial={question} /> : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Conversation({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; question: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    if (initial && !sentInitial.current) {
      sentInitial.current = true;
      void ask(initial);
    } else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The newest turn in view, from its start (a long answer is read from the top).
  useEffect(() => {
    const el = listRef.current;
    const last = el?.lastElementChild as HTMLElement | null;
    if (el && last) el.scrollTop = Math.max(0, last.offsetTop - 12);
  }, [turns.length, pending]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setError(null);
    setDraft("");
    const history = turns.slice(-6).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "user", text: q }]);
    setPending(true);
    try {
      const res = await api.post<HelpAnswer>("/api/help/ask", { question: q, path: pathname, history });
      setTurns((t) => [...t, { role: "assistant", text: res.answer, place: helpPlace(res.placeId) }]);
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setError({ message: errorMessage(e), question: q });
      setDraft(q);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function takeMeThere(place: HelpPlace, answer: string) {
    const r = resolvePlace(place, router.state.location.pathname);
    closeHelp();
    if (r.href) router.history.push(r.href);
    const body = r.inScope ? answer : `${answer} Primero abrí una: te marco dónde están.`;
    // Give the new screen a moment to render before lighting the button up.
    setTimeout(() => pointAt(r.target, place.name, body), r.href ? 450 : 50);
  }

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-lilac-soft text-lilac-ink" aria-hidden="true">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <RD.Title className="text-[15px] font-semibold tracking-[-0.02em] text-ink">¿Dónde está…?</RD.Title>
          <RD.Description className="text-[12.5px] text-text-3">Te digo dónde está y te llevo hasta el botón.</RD.Description>
        </div>
        <RD.Close className="inline-flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-sunken max-sm:size-11" aria-label="Cerrar la ayuda">
          <X className="size-4" />
        </RD.Close>
      </div>

      <div ref={listRef} className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.length === 0 && !pending ? (
          <div>
            <p className="text-[14px] leading-6 text-text-2">Preguntame con tus palabras qué querés hacer. Por ejemplo:</p>
            <div className="mt-3 flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-left text-[13.5px] text-text transition-colors hover:border-lilac/60 hover:bg-lilac-soft max-sm:min-h-11"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2 text-[14px] leading-6 break-words text-on-primary">{t.text}</p>
            </div>
          ) : (
            <div key={i} className="animate-rise">
              <p className="text-[14px] leading-6 text-text">{t.text}</p>
              {t.place ? (
                <button
                  type="button"
                  onClick={() => takeMeThere(t.place!, t.text)}
                  className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-md bg-lilac-soft px-3 text-[13.5px] font-medium text-lilac-ink transition-colors hover:brightness-95 max-sm:min-h-11"
                >
                  Llevame: {t.place.name}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ),
        )}
        {pending ? (
          <p className="flex items-center gap-1.5 text-[13.5px] text-text-3">
            Buscando
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac" aria-hidden="true" />
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac [animation-delay:200ms]" aria-hidden="true" />
            <span className="animate-pulse-dot inline-block size-1.5 rounded-full bg-lilac [animation-delay:400ms]" aria-hidden="true" />
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="rounded-md border border-rose/20 bg-rose-soft/60 px-3 py-2.5 text-[13.5px] text-text">
            {error.message}
            <button type="button" onClick={() => void ask(error.question)} className="mt-1.5 flex items-center gap-1.5 font-medium text-ink hover:underline">
              <RotateCcw className="size-3.5" aria-hidden="true" /> Reintentar
            </button>
          </div>
        ) : null}
      </div>

      <form
        className="safe-bottom border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-paper p-1.5 pl-3 transition-colors focus-within:border-lilac-ink focus-within:ring-3 focus-within:ring-lilac/20">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={1}
            maxLength={HELP_QUESTION_MAX}
            placeholder="¿Dónde…? ¿Cómo hago para…?"
            aria-label="Tu pregunta"
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-text outline-none placeholder:text-text-3"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            aria-label="Preguntar"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:bg-line-strong disabled:text-surface max-sm:size-11"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </>
  );
}

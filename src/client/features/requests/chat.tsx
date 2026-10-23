import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ImagePlus, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { LogoMark } from "@client/components/brand/logo";
import { Button } from "@client/components/ui/button";
import { Textarea } from "@client/components/ui/field";
import { cn } from "@client/lib/cn";
import { fmtTime } from "@client/lib/format";
import { prepareImage } from "@client/features/materials/prepare-image";
import {
  REQUEST_IMAGES_MAX,
  REQUEST_TEXT_MAX,
  type ChangeRequestView,
  type RequestImage,
} from "@shared/contracts/requests";

const PER_MESSAGE = 3;

function Thinking() {
  return (
    <div className="flex items-end gap-2.5" role="status">
      <LogoMark className="size-8 shrink-0" />
      <div className="flex h-11 items-center gap-1.5 rounded-[18px] rounded-bl-md border border-line bg-surface px-4">
        {[0, 160, 320].map((d) => (
          <span
            key={d}
            className="size-2 animate-pulse-dot rounded-full bg-lilac"
            style={{ animationDelay: `${d}ms` }}
            aria-hidden="true"
          />
        ))}
        <span className="sr-only">Pensando una respuesta…</span>
      </div>
    </div>
  );
}

function Shots({
  images,
  onDark,
}: {
  images: RequestImage[];
  onDark?: boolean;
}) {
  if (!images.length) return null;
  return (
    <div
      className={cn(
        "grid gap-1.5",
        images.length > 1 ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {images.map((img) => (
        <a
          key={img.id}
          href={img.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "block overflow-hidden rounded-[12px] border",
            onDark ? "border-white/20" : "border-line",
          )}
        >
          <img
            src={img.url}
            alt={`Captura: ${img.name}`}
            className="max-h-56 w-full bg-white object-cover"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

/** The conversation with the interviewer: her messages on the right, the AI's on the left. */
export function Conversation({
  request,
  thinking,
  failed,
  onRetry,
  retrying,
}: {
  request: ChangeRequestView;
  thinking: boolean;
  failed: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const images = useMemo(
    () => new Map(request.images.map((i) => [i.id, i])),
    [request.images],
  );
  const end = useRef<HTMLDivElement>(null);
  const count = request.messages.length;
  useEffect(() => {
    if (count > 1 || thinking)
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, thinking]);

  return (
    <div>
      <ol className="space-y-4" aria-label="Conversación">
        {request.messages.map((m, i) => {
          const shots = m.imageIds.flatMap((id) => images.get(id) ?? []);
          if (m.role === "assistant") {
            return (
              <li key={i} className="flex items-end gap-2.5 animate-rise">
                <LogoMark className="size-8 shrink-0" />
                <div className="max-w-[85%] rounded-[18px] rounded-bl-md border border-line bg-surface px-4 py-3 shadow-1">
                  <p className="sr-only">Asistente:</p>
                  <p className="text-[15px] leading-6 whitespace-pre-wrap text-text">
                    {m.text}
                  </p>
                </div>
              </li>
            );
          }
          return (
            <li key={i} className="flex flex-col items-end gap-1 animate-rise">
              <div className="max-w-[85%] space-y-2 rounded-[18px] rounded-br-md bg-ink px-4 py-3 text-white shadow-1">
                <p className="sr-only">Vos:</p>
                <Shots images={shots} onDark />
                {m.text ? (
                  <p className="text-[15px] leading-6 whitespace-pre-wrap">
                    {m.text}
                  </p>
                ) : null}
              </div>
              <span className="pr-1 text-[11px] text-text-3">
                {fmtTime(m.at)}
              </span>
            </li>
          );
        })}
        {thinking ? (
          <li>
            <Thinking />
          </li>
        ) : failed ? (
          <li
            className="flex flex-col gap-3 rounded-[14px] border border-amber/30 bg-amber-soft px-4 py-3 sm:flex-row sm:items-center"
            role="alert"
          >
            <p className="flex-1 text-sm leading-6 text-amber">
              Tu mensaje quedó guardado, pero no pude responderte. Probá de
              nuevo en un momento.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="size-4" />}
              loading={retrying}
              onClick={onRetry}
            >
              Reintentar
            </Button>
          </li>
        ) : null}
      </ol>
      <div ref={end} />
    </div>
  );
}

/** Text plus up to three screenshots; Enter sends on a computer, Shift+Enter makes a new line. */
export function Composer({
  request,
  busy,
  onSend,
}: {
  request: ChangeRequestView;
  busy: boolean;
  onSend: (text: string, files: File[]) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [preparing, setPreparing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const room =
    Math.min(PER_MESSAGE, REQUEST_IMAGES_MAX - request.images.length) -
    files.length;
  const canSend =
    !busy && !preparing && (text.trim().length > 0 || files.length > 0);

  useEffect(
    () => () => files.forEach((f) => URL.revokeObjectURL(f.url)),
    [files],
  );

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list).slice(0, Math.max(0, room));
    if (list.length > chosen.length)
      toast.message(
        `Podés sumar hasta ${PER_MESSAGE} capturas por mensaje y ${REQUEST_IMAGES_MAX} por pedido.`,
      );
    setPreparing(true);
    try {
      const ready = await Promise.all(chosen.map((f) => prepareImage(f)));
      setFiles((cur) => [
        ...cur,
        ...ready.map((file) => ({ file, url: URL.createObjectURL(file) })),
      ]);
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = "";
    }
  }

  async function send() {
    if (!canSend) return;
    try {
      await onSend(
        text.trim(),
        files.map((f) => f.file),
      );
      setText("");
      setFiles([]);
      area.current?.focus();
    } catch {
      // Not saved: the page shows why, and what she wrote stays here.
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: coarse)").matches;
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !coarse &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <form
      className="rounded-[20px] border border-line-strong bg-surface p-2 shadow-2 transition-shadow focus-within:border-lilac-ink focus-within:ring-4 focus-within:ring-lilac/20"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {files.length ? (
        <ul
          className="flex flex-wrap gap-2 px-2 pt-2"
          aria-label="Capturas para enviar"
        >
          {files.map((f, i) => (
            <li key={f.url} className="relative">
              <img
                src={f.url}
                alt={`Captura ${i + 1}`}
                className="size-16 rounded-[10px] border border-line object-cover"
              />
              <button
                type="button"
                onClick={() =>
                  setFiles((cur) => cur.filter((x) => x.url !== f.url))
                }
                className="absolute -top-2 -right-2 inline-flex size-7 items-center justify-center rounded-full bg-ink text-white shadow-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac-ink"
                aria-label={`Quitar captura ${i + 1}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor="pedido-mensaje" className="sr-only">
        Tu mensaje
      </label>
      <Textarea
        id="pedido-mensaje"
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        maxLength={REQUEST_TEXT_MAX}
        minRows={2}
        maxRows={10}
        disabled={busy}
        placeholder={
          request.messages.some((m) => m.role === "teacher")
            ? "Respondé acá…"
            : "Ej.: En la reflexión final quiero poder sacar una pregunta…"
        }
        className="border-0 bg-transparent shadow-none hover:border-0 focus:ring-0 disabled:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void pick(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<ImagePlus className="size-4" />}
          disabled={busy || room <= 0}
          loading={preparing}
          onClick={() => input.current?.click()}
        >
          Adjuntar captura
        </Button>
        <Button
          type="submit"
          size="sm"
          icon={<Send className="size-4" />}
          disabled={!canSend}
          loading={busy}
        >
          Enviar
        </Button>
      </div>
    </form>
  );
}

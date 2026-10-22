// Voice for activities with voice on (loaded lazily). Dictation uses the browser's own
// speech recognition (window.SpeechRecognition / webkitSpeechRecognition) and writes into the
// composer, so the student can review the text before sending. Read-aloud uses
// speechSynthesis, one reply at a time, only when the student taps "Escuchar" (no autoplay).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { cn } from "@client/lib/cn";
import { MAX_VOICE_SECONDS, chunkSpeech, speakableText } from "@shared/domain/voice";
import { recognitionCtor, type RecognitionLike } from "./voice-support";
import { useT, type StudentStrings } from "./i18n";

// ── Dictation ──

export interface DictationStatus {
  listening: boolean;
  seconds: number;
  error: string | null;
}

function dictationError(code: string, t: StudentStrings["voice"]): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return t.notAllowed;
    case "no-speech":
      return t.noSpeech;
    case "audio-capture":
      return t.audioCapture;
    case "network":
      return t.network;
    case "language-not-supported":
      return t.languageNotSupported;
    default:
      return t.generic;
  }
}

export function DictationButton({
  lang,
  disabled,
  getBase,
  onTranscript,
  onStatus,
  stopKey,
}: {
  lang: string;
  disabled?: boolean;
  /** Text already in the composer when dictation starts (dictation is appended to it). */
  getBase: () => string;
  onTranscript: (fullText: string) => void;
  onStatus: (s: DictationStatus) => void;
  /** Changing this value stops dictation (the student typed or sent). */
  stopKey: number;
}) {
  const t = useT().voice;
  const rec = useRef<RecognitionLike | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [listening, setListening] = useState(false);
  const status = useRef(onStatus);
  status.current = onStatus;

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stop = () => rec.current?.stop();

  // The student typed or sent: stop and ignore results that arrive late, so a sent message
  // never comes back into the composer.
  useEffect(() => {
    const r = rec.current;
    if (!r) return;
    r.onresult = null;
    r.stop();
  }, [stopKey]);

  useEffect(
    () => () => {
      clearTimer();
      rec.current?.abort();
    },
    [],
  );

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    const base = getBase();
    const sep = base && !/\s$/.test(base) ? " " : "";
    let seconds = 0;
    let error: string | null = null;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0].transcript;
      text = text.replace(/\s+/g, " ").trimStart();
      if (text) onTranscript(base + sep + text);
    };
    r.onerror = (e) => {
      error = dictationError(e.error, t);
      status.current({ listening: false, seconds, error });
    };
    r.onend = () => {
      clearTimer();
      rec.current = null;
      setListening(false);
      status.current({ listening: false, seconds, error });
    };
    try {
      r.start();
    } catch {
      status.current({ listening: false, seconds: 0, error: dictationError("", t) });
      return;
    }
    rec.current = r;
    setListening(true);
    status.current({ listening: true, seconds: 0, error: null });
    timer.current = setInterval(() => {
      seconds += 1;
      status.current({ listening: true, seconds, error: null });
      if (seconds >= MAX_VOICE_SECONDS) r.stop();
    }, 1000);
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={disabled && !listening}
      aria-pressed={listening}
      aria-label={listening ? t.stopDictation : t.dictate}
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
        listening ? "bg-rose-soft text-rose" : "text-text-2 hover:bg-sunken hover:text-ink",
      )}
    >
      {listening ? (
        <>
          <Square className="size-4 fill-current" aria-hidden="true" />
          <span className="animate-pulse-dot absolute top-2 right-2 size-2 rounded-full bg-rose" aria-hidden="true" />
        </>
      ) : (
        <Mic className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}

// ── Read aloud ──

let speakingId: string | null = null;
let generation = 0;
const listeners = new Set<() => void>();
const setSpeaking = (id: string | null) => {
  speakingId = id;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const short = lang.slice(0, 2);
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.replace("_", "-").startsWith(short)) ?? null;
}

function speak(id: string, markdown: string, lang: string) {
  const synth = window.speechSynthesis;
  const gen = ++generation;
  synth.cancel();
  const chunks = chunkSpeech(speakableText(markdown));
  if (!chunks.length) return setSpeaking(null);
  const voice = pickVoice(lang);
  setSpeaking(id);
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = lang;
    if (voice) u.voice = voice;
    if (lang.startsWith("en")) u.rate = 0.92;
    const finish = () => {
      if (gen === generation) setSpeaking(null);
    };
    if (i === chunks.length - 1) u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

function stopReading() {
  generation++;
  window.speechSynthesis.cancel();
  setSpeaking(null);
}

export function ListenButton({ id, text, lang }: { id: string; text: string; lang: string }) {
  const t = useT().voice;
  const current = useSyncExternalStore(subscribe, () => speakingId, () => null);
  const playing = current === id;
  useEffect(() => () => {
    if (speakingId === id) stopReading();
  }, [id]);
  return (
    <button
      type="button"
      onClick={() => (playing ? stopReading() : speak(id, text, lang))}
      aria-pressed={playing}
      className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-text-3 transition-colors hover:bg-sunken hover:text-ink"
    >
      {playing ? <Square className="size-3.5 fill-current" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
      {playing ? t.stop : t.listen}
    </button>
  );
}

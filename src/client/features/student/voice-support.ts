// Feature detection for the browser's Web Speech API. Tiny on purpose: the voice UI itself
// (voice.tsx) is loaded lazily only when the activity has voice on AND the browser supports it.
import type { VoiceLanguage } from "@shared/domain/voice";

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canDictate = () => recognitionCtor() !== null;
export const canSpeak = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

export const speechLang = (v: VoiceLanguage) => (v === "en" ? "en-US" : "es-AR");

/** Stops any reading in progress (safe to call when unsupported). */
export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

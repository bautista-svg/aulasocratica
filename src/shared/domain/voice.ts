// Client-safe rules for voice messages with the tutor. The teacher picks the language per
// activity; students record a voice message that is transcribed into the chat, and the
// tutor's written reply is read aloud.

export type VoiceLanguage = "off" | "es" | "en";

export const VOICE_LANGUAGE_LABELS: Record<VoiceLanguage, { label: string; description: string }> = {
  off: { label: "Desactivada", description: "Los alumnos solo escriben." },
  es: { label: "En castellano", description: "Los alumnos pueden hablarle al tutor y escuchar sus respuestas en castellano." },
  en: { label: "En inglés", description: "Práctica oral en inglés con el material: el tutor conversa y responde en inglés." },
};

export function isVoiceLanguage(v: unknown): v is VoiceLanguage {
  return v === "off" || v === "es" || v === "en";
}

/** Longest voice message a student can record, in seconds. */
export const MAX_VOICE_SECONDS = 120;
/** Upload cap for one recording (16 kHz mono WAV ≈ 32 KB/s; leaves headroom for 48 kHz devices). */
export const MAX_VOICE_BYTES = 12 * 1024 * 1024;
/** Characters per speech request; replies are split at sentence boundaries. */
export const SPEECH_CHUNK_CHARS = 600;

/** Plain text to read aloud: drops markdown marks, links and code fences. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`~>|]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Splits text into ordered chunks of at most `max` characters, at sentence boundaries when possible. */
export function chunkSpeech(text: string, max = SPEECH_CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?¡¿\n]+[.!?]*\s*|\n/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
      continue;
    }
    if ((current + s).length > max) push();
    current += s;
  }
  push();
  return chunks.filter(Boolean);
}

/** Tutor rules for voice activities, added under the global rules. */
export function voiceTutorRules(lang: VoiceLanguage): string {
  if (lang === "off") return "";
  const spoken =
    "Tus respuestas se leen en voz alta: escribí como se habla, en oraciones cortas, sin listas, tablas, emojis ni formato. Los mensajes del estudiante pueden venir de una grabación transcripta: no corrijas puntuación ni ortografía de esos mensajes.";
  if (lang === "en") {
    return [
      "MODO AUDIO — PRÁCTICA DE INGLÉS: esta actividad es práctica oral en inglés con el material.",
      "Conversá en inglés, con vocabulario y frases adecuados a la edad y al nivel del estudiante. Mantené las reglas socráticas: una pregunta por turno y sin dar la respuesta.",
      "Si el estudiante comete un error de inglés, reformulá su idea de forma correcta en tu respuesta (sin sermonear ni enumerar errores) y seguí la conversación.",
      "Si el estudiante escribe en castellano o dice que no entiende, podés aclarar brevemente en castellano y volver al inglés invitándolo a intentarlo.",
      spoken,
    ].join("\n");
  }
  return ["MODO AUDIO — CASTELLANO: el estudiante puede hablarte por audio.", spoken].join("\n");
}

/** Style line prepended to the text sent to the speech model. */
export function speechStyle(lang: VoiceLanguage): string {
  return lang === "en"
    ? "Read aloud in a warm, clear, friendly teacher voice, at a slightly slow pace for students learning English: "
    : "Leé en voz alta, con voz cálida y clara de docente, en español rioplatense: ";
}

// What the student actually wrote (the only valid source of quotes) and a transcript of
// the whole conversation for the AI, shortened only when it is extremely long.
import { STUDENT_INTENTS, type StudentIntent } from "@shared/domain/pedagogy";
import { intentMessages } from "@shared/domain/language";
import { normalizeForMatch, quoteAppears, tutorQuestion } from "@shared/domain/thinking-xray";
import type { ReflectionAnswer } from "@shared/domain/activity-design";

export interface CorpusMessage {
  role: string;
  content: string;
  intent: string | null;
  isPartial?: boolean;
}

const CANNED = (Object.keys(STUDENT_INTENTS) as StudentIntent[]).flatMap((k) => intentMessages(k));
const CANNED_NORMALIZED = new Set(CANNED.map(normalizeForMatch));

/**
 * The student's own words in a message: the canned text of the help buttons ("Necesito una
 * pista.", "Tengo otra idea:") is removed, so it can never be used as evidence.
 */
export function ownWords(m: CorpusMessage): string {
  let text = m.content.trim();
  const key = m.intent && m.intent in STUDENT_INTENTS ? (m.intent as StudentIntent) : null;
  const prefix = key ? intentMessages(key).find((msg) => text.startsWith(msg)) : undefined;
  if (prefix) text = text.slice(prefix.length).trim();
  if (CANNED_NORMALIZED.has(normalizeForMatch(text))) return "";
  return text;
}

/** Every piece of text the student wrote in the session, without button texts. */
export function studentTexts(s: {
  initialAnswer: string | null;
  finalAnswer: string | null;
  reflection: ReflectionAnswer[];
  messages: CorpusMessage[];
}): string[] {
  return [
    s.initialAnswer ?? "",
    ...s.messages.filter((m) => m.role === "user" && !m.isPartial).map(ownWords),
    s.finalAnswer ?? "",
    ...s.reflection.map((r) => r.answer),
  ]
    .map((t) => t.trim())
    .filter(Boolean);
}

/** True when the quote appears (normalized) inside ONE of the student's texts. */
export function quoteInTexts(quote: string, texts: string[]): boolean {
  if (!quote.trim()) return false;
  return texts.some((t) => quoteAppears(quote, t));
}

/** Data blocks are fenced; the fence markers themselves are removed from the content. */
export function fence(s: string, max = 20_000): string {
  return s.replace(/<<<|>>>/g, "").trim().slice(0, max);
}

const MAX_MESSAGE_CHARS = 4000;

function line(m: CorpusMessage, shortTutor: boolean): string {
  if (m.role === "assistant") {
    if (shortTutor) {
      const q = tutorQuestion(m.content);
      return `TUTOR (resumido a su pregunta): ${q ?? m.content.slice(0, 200)}`;
    }
    return `TUTOR: ${m.content.slice(0, MAX_MESSAGE_CHARS)}`;
  }
  const intent = m.intent && m.intent in STUDENT_INTENTS ? STUDENT_INTENTS[m.intent as keyof typeof STUDENT_INTENTS] : null;
  const own = ownWords(m).slice(0, MAX_MESSAGE_CHARS);
  if (intent) return `ALUMNO [tocó el botón «${intent.label}»]${own ? `: ${own}` : ""}`;
  return `ALUMNO: ${own}`;
}

/**
 * The whole conversation (no message limit). If it does not fit in `maxChars`, tutor turns
 * are reduced to their question first; only if it still does not fit, the middle of the
 * conversation is left out and the number of omitted messages is reported.
 */
export function buildTranscript(messages: CorpusMessage[], maxChars = 120_000): { text: string; omitted: number; shortened: boolean } {
  const list = messages.filter((m) => !m.isPartial);
  if (list.length === 0) return { text: "", omitted: 0, shortened: false };
  let lines = list.map((m) => line(m, false));
  const size = (ls: string[]) => ls.reduce((n, l) => n + l.length + 1, 0);
  if (size(lines) <= maxChars) return { text: lines.join("\n"), omitted: 0, shortened: false };

  lines = list.map((m) => line(m, true));
  if (size(lines) <= maxChars) return { text: lines.join("\n"), omitted: 0, shortened: true };

  // Keep the beginning and the end (where the student's thinking starts and lands).
  const head: string[] = [];
  const tail: string[] = [];
  let used = 200;
  let i = 0;
  let j = lines.length - 1;
  let turn = 0;
  while (i <= j) {
    const next = turn % 2 === 0 ? lines[i]! : lines[j]!;
    if (used + next.length + 1 > maxChars) break;
    used += next.length + 1;
    if (turn % 2 === 0) head.push(lines[i++]!);
    else tail.unshift(lines[j--]!);
    turn++;
  }
  const omitted = j - i + 1;
  const marker = omitted > 0 ? [`[… se omitieron ${omitted} mensajes intermedios por la extensión de la conversación …]`] : [];
  return { text: [...head, ...marker, ...tail].join("\n"), omitted: Math.max(0, omitted), shortened: true };
}

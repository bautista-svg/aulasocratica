// How an activity is organized for the student (asked for by Vanina Gerstner, 23-10): an optional
// presentation, the objectives, consignas shown one at a time (each with its own title and,
// if the teacher wants, its own written answer), the final production, the reflection and the
// closing message — every section can be shown or hidden, and its title and subtitle are the
// teacher's. Activities saved before keep working: their consignas are derived from the old
// fields and the old "one answer per consigna at the end" becomes an answer in each consigna.
import { consignasOf } from "./consignas";
import type { ActivityLanguage } from "./language";

export const CONSIGNA_TITLE_MAX = 120;
export const SECTION_TITLE_MAX = 80;
export const SECTION_SUBTITLE_MAX = 240;
export const PRESENTATION_MAX = 6000;

export interface Consigna {
  id: string;
  /** "" = the default title ("Comenzamos la actividad" for the first one, "Consigna N" after). */
  title: string;
  text: string;
  /** The student writes an answer for this consigna (otherwise it only guides the conversation). */
  answer: boolean;
}

export const DEFAULT_FIRST_CONSIGNA_TITLE: Record<ActivityLanguage, string> = { es: "Comenzamos la actividad", en: "Let's get started" };

export function consignaTitle(c: Pick<Consigna, "title">, i: number, lang: ActivityLanguage = "es"): string {
  if (c.title.trim()) return c.title.trim();
  if (i === 0) return DEFAULT_FIRST_CONSIGNA_TITLE[lang];
  return lang === "en" ? `Task ${i + 1}` : `Consigna ${i + 1}`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/** Stored consignas made valid (empty ones dropped, at most `max`). */
export function sanitizeConsignas(raw: unknown, maxText: number, max: number): Consigna[] {
  if (!Array.isArray(raw)) return [];
  const out: Consigna[] = [];
  const ids = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object" || out.length >= max) continue;
    const o = r as Record<string, unknown>;
    const text = str(o.text, maxText);
    if (!text) continue;
    let id = typeof o.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(o.id) ? o.id : `c${out.length + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    out.push({ id, title: str(o.title, CONSIGNA_TITLE_MAX), text, answer: o.answer === true });
  }
  return out;
}

interface StructureSource {
  consignas: unknown;
  instructions: string;
  moreInstructions: unknown;
  askFinalAnswer: boolean;
}

/** Saved before consignas had their own structure (the old fields are the source). */
const isLegacy = (a: StructureSource) => !Array.isArray(a.consignas) || a.consignas.length === 0;

/** The activity's consignas, structured (derived from the old fields when needed). */
export function structuredConsignas(a: StructureSource, maxText = 6000, max = 8): Consigna[] {
  if (!isLegacy(a)) {
    const list = sanitizeConsignas(a.consignas, maxText, max);
    if (list.length) return list;
  }
  const texts = consignasOf({ instructions: a.instructions, moreInstructions: a.moreInstructions });
  // Before: several consignas + final answer = one answer per consigna at the end. Now each
  // consigna asks for its answer while the student works on it.
  const perConsigna = a.askFinalAnswer && texts.length > 1;
  return texts.map((text, i) => ({ id: `c${i + 1}`, title: "", text, answer: perConsigna }));
}

/** Whether the closing asks for a final production (legacy per-consigna answers moved into the consignas). */
export function asksFinalProduction(a: StructureSource): boolean {
  if (isLegacy(a)) {
    const texts = consignasOf({ instructions: a.instructions, moreInstructions: a.moreInstructions });
    return a.askFinalAnswer && texts.length <= 1;
  }
  return a.askFinalAnswer;
}

/** The old fields, kept in step with the consignas (the tutor, the AI analyses and exports read them). */
export function legacyFields(consignas: Consigna[]): { instructions: string; moreInstructions: string[] } {
  return { instructions: consignas[0]?.text ?? "", moreInstructions: consignas.slice(1).map((c) => c.text) };
}

// ── Modalities ──

export type ActivityMode = "conversacion" | "respuestas" | "produccion";
export const ACTIVITY_MODES: ActivityMode[] = ["conversacion", "respuestas", "produccion"];
export const MODE_LABELS: Record<ActivityMode, { title: string; description: string }> = {
  conversacion: { title: "Solo conversación", description: "El alumno trabaja dialogando con el tutor. No escribe respuestas." },
  respuestas: { title: "Conversación y respuestas", description: "Conversa con el tutor y escribe una respuesta en cada consigna." },
  produccion: { title: "Conversación y producción final", description: "Investiga conversando con el tutor y al final escribe su producción." },
};

/** The modality the settings describe (the teacher can also mix them by hand). */
export function modeOf(consignas: Pick<Consigna, "answer">[], askFinal: boolean): ActivityMode {
  if (consignas.some((c) => c.answer)) return "respuestas";
  return askFinal ? "produccion" : "conversacion";
}

// ── Sections: their titles and subtitles, as the students see them ──

export const SECTION_KEYS = ["presentacion", "objetivos", "respuesta_inicial", "respuesta_final", "reflexion", "cierre"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface SectionText {
  title: string;
  subtitle: string;
}
export type SectionTitles = Partial<Record<SectionKey, SectionText>>;

/**
 * What the students read when the teacher writes no title or subtitle (the same texts their
 * screens always had). For "respuesta_final" the title is the label of the answer field: the
 * question itself is the activity's final question.
 */
export const SECTION_DEFAULTS: Record<ActivityLanguage, Record<SectionKey, SectionText>> = {
  es: {
    presentacion: { title: "Presentación", subtitle: "" },
    objetivos: { title: "Lo que vas a aprender", subtitle: "" },
    respuesta_inicial: {
      title: "¿Qué pensás vos?",
      subtitle:
        "Escribí tu primera idea sobre la consigna, aunque no estés seguro. Cuando la guardes ya no se puede cambiar: al final vas a escribir tu respuesta mejorada.",
    },
    respuesta_final: {
      title: "Tu respuesta final",
      subtitle: "Escribí tu respuesta final con tus palabras y contá cómo lo pensaste. Cuando la envíes ya no vas a poder cambiarla, y tu docente va a poder leerla.",
    },
    reflexion: { title: "Tu reflexión", subtitle: "Contá cómo fue tu forma de pensar. Podés responder las que quieras." },
    cierre: { title: "Un mensaje de tu docente", subtitle: "" },
  },
  en: {
    presentacion: { title: "Introduction", subtitle: "" },
    objetivos: { title: "What you'll learn", subtitle: "" },
    respuesta_inicial: {
      title: "What do you think?",
      subtitle: "Write your first idea about the task, even if you're not sure. Once you save it, you can't change it: at the end you'll write your improved answer.",
    },
    respuesta_final: {
      title: "Your final answer",
      subtitle:
        "Write your final answer in your own words and explain how you thought about it. Once you send it, you won't be able to change it, and your teacher will be able to read it.",
    },
    reflexion: { title: "Your reflection", subtitle: "Tell us how you thought it through. You can answer as many as you want." },
    cierre: { title: "A note from your teacher", subtitle: "" },
  },
};

/** Section names in the editor (the teacher's view). */
export const SECTION_EDITOR_NAMES: Record<SectionKey, string> = {
  presentacion: "Presentación",
  objetivos: "Objetivos",
  respuesta_inicial: "Respuesta inicial",
  respuesta_final: "Respuesta final",
  reflexion: "Reflexión final",
  cierre: "Mensaje final",
};

export function sanitizeSectionTitles(raw: unknown): SectionTitles {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: SectionTitles = {};
  for (const k of SECTION_KEYS) {
    const v = o[k];
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const title = str(r.title, SECTION_TITLE_MAX);
    const subtitle = str(r.subtitle, SECTION_SUBTITLE_MAX);
    if (title || subtitle) out[k] = { title, subtitle };
  }
  return out;
}

/** The title and subtitle the students read: the teacher's, else the default. */
export function sectionText(titles: SectionTitles, key: SectionKey, lang: ActivityLanguage): SectionText {
  const own = titles[key];
  const d = SECTION_DEFAULTS[lang][key];
  return { title: own?.title || d.title, subtitle: own?.subtitle || d.subtitle };
}

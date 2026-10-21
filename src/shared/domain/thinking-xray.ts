// Client-safe rules for the "Radiografía del pensamiento".
// Observed data comes straight from the session; AI interpretations are suggestions
// that must quote the student's own words and that the teacher validates, edits or discards.

export type XrayMoment = "before" | "during" | "after";
export type XrayStatus = "suggested" | "validated" | "discarded";

export const XRAY_MOMENTS: Record<XrayMoment, { title: string; categories: Record<string, string> }> = {
  before: {
    title: "Antes de la IA",
    categories: {
      prior_knowledge: "Conocimientos previos expresados",
      hypothesis: "Hipótesis inicial",
      initial_argument: "Argumentos iniciales",
    },
  },
  during: {
    title: "Durante la interacción",
    categories: {
      error_revised: "Errores revisados",
      argument_added: "Argumentos agregados",
      strategy_change: "Cambios de estrategia",
      reformulation: "Momentos de reformulación",
    },
  },
  after: {
    title: "Después de la IA",
    categories: {
      autonomous_explanation: "Explicación autónoma",
      metacognition: "Reflexión metacognitiva",
    },
  },
};

export interface XrayItem {
  id: string;
  moment: XrayMoment;
  category: string;
  interpretation: string;
  evidence: string;
  status: XrayStatus;
  edited: boolean;
}

export const MAX_XRAY_ITEMS = 18;
const MIN_QUOTE_CHARS = 6;

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True only when the quoted evidence really appears in what the student wrote. */
export function quoteAppears(quote: string, corpus: string): boolean {
  const q = normalizeForMatch(quote.replace(/^["'«“]+|["'»”]+$/g, "").replace(/\.\.\.|…/g, " "));
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForMatch(corpus).includes(q);
}

function isMoment(m: unknown): m is XrayMoment {
  return m === "before" || m === "during" || m === "after";
}

/** Keeps only well-formed items whose category belongs to their moment. */
export function sanitizeXrayItems(raw: unknown): XrayItem[] {
  if (!Array.isArray(raw)) return [];
  const out: XrayItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Partial<Record<"id" | "moment" | "category" | "interpretation" | "evidence" | "status" | "edited", unknown>>;
    if (!isMoment(o.moment)) continue;
    const category = String(o.category ?? "");
    if (!XRAY_MOMENTS[o.moment].categories[category]) continue;
    const interpretation = String(o.interpretation ?? "").trim().slice(0, 600);
    const evidence = String(o.evidence ?? "").trim().slice(0, 400);
    if (!interpretation || !evidence) continue;
    const status: XrayStatus = o.status === "validated" || o.status === "discarded" ? o.status : "suggested";
    out.push({
      id: typeof o.id === "string" && o.id ? o.id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
      moment: o.moment,
      category,
      interpretation,
      evidence,
      status,
      edited: o.edited === true,
    });
    if (out.length >= MAX_XRAY_ITEMS) break;
  }
  return out;
}

/** When re-analyzing, keep what the teacher already validated or edited and replace the rest. */
export function mergeReanalysis(previous: XrayItem[], fresh: XrayItem[]): XrayItem[] {
  const kept = previous.filter((i) => i.status === "validated" || i.edited);
  return [...kept, ...fresh].slice(0, MAX_XRAY_ITEMS);
}

export interface FlowMessage {
  role: string;
  content: string;
  intent: string | null;
  createdAt: string;
}

const REFORMULATION_INTENTS = new Set(["review", "other_idea", "explain"]);

/** Last question in a tutor turn (what the tutor actually asked). */
export function tutorQuestion(content: string): string | null {
  const plain = content.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  const matches = plain.match(/[^.!?¿¡]*¿?[^.!?¿¡]*\?/g);
  const q = matches?.map((s) => s.trim()).filter((s) => s.length > 3).pop();
  return q ? q.slice(0, 300) : null;
}

/** Observed path: initial answer → tutor questions → reformulations → final answer. */
export function buildThinkingFlow(messages: FlowMessage[]) {
  const tutorQuestions = messages
    .filter((m) => m.role === "assistant")
    .map((m) => tutorQuestion(m.content))
    .filter((q): q is string => !!q);
  const reformulations = messages
    .filter((m) => m.role === "user" && m.intent && REFORMULATION_INTENTS.has(m.intent))
    .map((m) => ({ text: m.content.slice(0, 600), at: m.createdAt, intent: m.intent as string }));
  const hints = messages.filter((m) => m.role === "user" && m.intent === "hint").length;
  return { tutorQuestions, reformulations, hints };
}

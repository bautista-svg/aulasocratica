// Pure helpers to fit an activity's material into a prompt. Short material goes in whole;
// long material (big PDFs) is split into fragments and the most relevant ones for the
// current conversation are chosen with a simple BM25 ranking — no page or length limit
// for the teacher, a bounded prompt for the model.

export interface MaterialSource {
  name: string;
  kind: string;
  text: string;
}

/** Characters of material sent whole to the tutor (≈ 75k tokens). */
export const FULL_MATERIAL_CHARS = 300_000;
/** Characters of excerpts when the material is longer than that. */
export const EXCERPT_BUDGET_CHARS = 120_000;
const CHUNK_CHARS = 1_800;

const FENCE = /<<<MATERIAL|MATERIAL>>>/g;

export function assembleMaterial(written: string, files: MaterialSource[]): string {
  const blocks: string[] = [];
  if (written.trim()) blocks.push(`[Material escrito por el docente]\n${written.trim()}`);
  for (const f of files) {
    const t = f.text.trim();
    if (!t) continue;
    const name = f.name.replace(/[\n<>]/g, " ").slice(0, 120);
    blocks.push(`[Archivo ${f.kind}: ${name}]\n${t}`);
  }
  // Uploaded content can never close the data fence early.
  return blocks.join("\n\n").replace(FENCE, "");
}

const STOP = new Set(
  "a al algo ante antes como con contra cual cuando de del desde donde el ella ellas ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas me mi muy no nos o otra otro para pero por porque que se si sin sobre su sus tambien te tu un una uno unos y ya yo vos sos the of and to in is".split(" "),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function splitChunks(text: string, size = CHUNK_CHARS): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > size) {
      if (cur) chunks.push(cur);
      cur = "";
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
      continue;
    }
    if ((cur + "\n\n" + p).length > size && cur) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Keeps "[Archivo …]" / "[Página N]" context so an excerpt is still traceable. */
function labelFor(chunks: string[], index: number): string {
  let file = "";
  let page = "";
  // The page/file in effect at the start of this chunk is the last marker seen before it.
  for (let i = index - 1; i >= 0 && (!file || !page); i--) {
    const c = chunks[i]!;
    if (!page) {
      const pm = [...c.matchAll(/\[Página (\d+)\]/g)].pop();
      if (pm) page = `desde página ${pm[1]}`;
    }
    if (!file) {
      const fm = [...c.matchAll(/\[(Archivo [^\]]+|Material escrito por el docente)\]/g)].pop();
      if (fm) file = fm[1]!;
    }
  }
  return [file, page].filter(Boolean).join(" · ");
}

export interface Selection {
  text: string;
  mode: "full" | "excerpts" | "empty";
  totalChars: number;
}

export function selectMaterial(full: string, query: string, opts: { fullLimit?: number; budget?: number } = {}): Selection {
  const fullLimit = opts.fullLimit ?? FULL_MATERIAL_CHARS;
  const budget = opts.budget ?? EXCERPT_BUDGET_CHARS;
  const totalChars = full.length;
  if (!full.trim()) return { text: "", mode: "empty", totalChars };
  if (full.length <= fullLimit) return { text: full, mode: "full", totalChars };

  const chunks = splitChunks(full);
  const docs = chunks.map(tokenize);
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const scores = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen)));
    }
    // Slight preference for the beginning (index, introduction) when nothing matches.
    return { i, s: s + (i < 3 ? 0.01 * (3 - i) : 0) };
  });
  scores.sort((a, z) => z.s - a.s);
  const picked: number[] = [];
  let used = 0;
  for (const { i } of scores) {
    const len = chunks[i]!.length + 60;
    if (used + len > budget) continue;
    picked.push(i);
    used += len;
    if (used >= budget * 0.97) break;
  }
  picked.sort((a, z) => a - z);
  const text = picked
    .map((i) => {
      const label = labelFor(chunks, i);
      return `[Fragmento${label ? ` — ${label}` : ""}]\n${chunks[i]}`;
    })
    .join("\n\n");
  return { text, mode: "excerpts", totalChars };
}

// Student names are the only identity a student has inside a classroom.

/** "  maría   josé PÉREZ " → "María José Pérez" (keeps what the student typed otherwise). */
export function tidyName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toLocaleUpperCase("es") + w.slice(1).toLocaleLowerCase("es") : w))
    .join(" ")
    .slice(0, 120);
}

/** Key used to recognise the same student: lowercase, no accents, single spaces. */
export function nameKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateStudentName(input: string): { ok: true; name: string; key: string } | { ok: false; error: string } {
  const name = tidyName(input);
  const key = nameKey(name);
  if (key.length < 2) return { ok: false, error: "Escribí tu nombre." };
  if (name.length > 120) return { ok: false, error: "El nombre es demasiado largo." };
  if (!/\p{L}/u.test(name)) return { ok: false, error: "Escribí tu nombre con letras." };
  return { ok: true, name, key };
}

/** Splits a pasted list (one per line, or separated by commas/semicolons). */
export function parseNameList(text: string): string[] {
  const parts = text.includes("\n") ? text.split(/\r?\n/) : text.split(/[;,]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const n = tidyName(p.replace(/^\s*\d+[.)-]\s*/, ""));
    const k = nameKey(n);
    if (k.length >= 2 && !seen.has(k)) {
      seen.add(k);
      out.push(n);
    }
  }
  return out;
}

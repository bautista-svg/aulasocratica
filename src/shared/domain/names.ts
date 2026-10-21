// Student names are the only identity a student has inside a classroom.

export const MAX_NAME_CHARS = 120;

// Invisible characters that can disguise a name (bidi overrides, zero-width spaces, BOM).
const INVISIBLE = /[​‎‏‪-‮⁠⁦-⁩﻿]/g;

/**
 * "  María   de los Ángeles  McDonald " → "María de los Ángeles McDonald".
 * Keeps exactly what the student (or the teacher) typed: only trims, collapses spaces and drops
 * invisible characters. Capitalization is never changed ("de", "McDonald", "DʼAngelo" stay as
 * typed); recognising the same person ignores case and accents through nameKey().
 */
export function tidyName(input: string): string {
  // Cut by code points so an emoji or accented letter is never split in half.
  return Array.from(clean(input)).slice(0, MAX_NAME_CHARS).join("").trim();
}

function clean(input: string): string {
  return input.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
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
  if (Array.from(clean(input)).length > MAX_NAME_CHARS) return { ok: false, error: "El nombre es demasiado largo." };
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

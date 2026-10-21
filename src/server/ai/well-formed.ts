// Text cut at an arbitrary position can split a character that takes two UTF-16 units (an emoji,
// or the math letters PDFs use, like 𝑥) and leave half of it ("lone surrogate"). The API rejects
// the WHOLE request then ("The request body is not valid JSON: unexpected end of hex escape"),
// so every string sent to it is made well-formed first: a lone half becomes "�".
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function wellFormedText(s: string): string {
  return s.replace(LONE_SURROGATE, "�");
}

/**
 * Deep copy of a request part (system prompt, messages) with well-formed strings. Base64 payloads
 * (`data` of images and documents) are left as they are: they are ASCII.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === "string") return wellFormedText(value) as T;
  if (Array.isArray(value)) return value.map((v) => wellFormed(v)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === "data" ? v : wellFormed(v);
    return out as T;
  }
  return value;
}

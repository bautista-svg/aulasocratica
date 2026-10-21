// Search-param validators for route definitions (`validateSearch`). Route options are part of the
// entry chunk that every page loads first, so they are plain functions instead of zod schemas:
// zod alone weighed ~60 KB (minified) of that chunk. Same rules as the zod schemas they replaced
// (`z.object({ … optional fields … })`): unknown keys are dropped and a value of the wrong type
// throws, which shows the route's error screen.

type Check<T> = (value: unknown, key: string) => T | undefined;

const invalid = (key: string) => new Error(`Parámetro de búsqueda inválido: ${key}`);

// zod's `z.string().uuid()` pattern (RFC 9562, any version, plus the nil and max UUIDs).
const UUID_RE = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export const optionalString: Check<string> = (v, key) => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw invalid(key);
  return v;
};

export const optionalUuid: Check<string> = (v, key) => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw invalid(key);
  return v;
};

export const optionalBoolean: Check<boolean> = (v, key) => {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw invalid(key);
  return v;
};

export function optionalEnum<const T extends readonly string[]>(values: T): Check<T[number]> {
  return (v, key) => {
    if (v === undefined) return undefined;
    if (typeof v !== "string" || !values.includes(v)) throw invalid(key);
    return v as T[number];
  };
}

type Shape = Record<string, Check<unknown>>;
type Output<S extends Shape> = { [K in keyof S]?: Exclude<ReturnType<S[K]>, undefined> };

/** `validateSearch` for a route whose search params are all optional. */
export function searchParams<S extends Shape>(shape: S): (input: Record<string, unknown>) => Output<S> {
  return (input) => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const value = shape[key]!(input[key], key);
      if (value !== undefined) out[key] = value;
    }
    return out as Output<S>;
  };
}

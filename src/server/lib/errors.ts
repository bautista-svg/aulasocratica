import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, type ZodType, type z } from "zod";
import { log, errorFields } from "./logger";

/** An error whose message is safe to show to the user (Spanish, actionable). */
export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
    public code = "error",
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = "El recurso") => new HttpError(404, `${what} no existe o no tenés acceso.`, "not_found");
export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, "invalid", fields);
export const forbidden = (message = "No tenés permiso para hacer esto.") => new HttpError(403, message, "forbidden");
export const conflict = (message: string) => new HttpError(409, message, "conflict");
export const tooMany = (message = "Demasiados intentos. Esperá un momento y volvé a probar.") =>
  new HttpError(429, message, "rate_limited");

function zodFields(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Parses JSON bodies with a schema; invalid input becomes a 400 with per-field messages. */
export async function readJson<S extends ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("El cuerpo de la solicitud no es JSON válido.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Revisá los datos ingresados.", zodFields(parsed.error));
  return parsed.data;
}

export function parseWith<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest("Revisá los datos ingresados.", zodFields(parsed.error));
  return parsed.data;
}

export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message, fields: err.fields } }, err.status);
  }
  // Hono's own HTTPException (body limit, etc.)
  const status = (err as { status?: number }).status;
  if (status === 413) {
    return c.json({ error: { code: "too_large", message: "El archivo o los datos enviados son demasiado grandes." } }, 413);
  }
  log.error("unhandled_error", { path: c.req.path, method: c.req.method, ...errorFields(err) });
  return c.json({ error: { code: "internal", message: "Ocurrió un error inesperado. Probá de nuevo en unos segundos." } }, 500);
}

// Single entry point to Claude. Every call goes through here so that availability,
// quotas, usage accounting and error messages behave the same everywhere.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { AI_PRICES_PER_MTOK } from "@shared/domain/ai-cost";
import type { z } from "zod";
import { env } from "../env";
import { db, schema } from "../db/client";
import { HttpError } from "../lib/errors";
import { log, errorFields } from "../lib/logger";
import { wellFormed } from "./well-formed";

export { wellFormed };

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, "La inteligencia artificial todavía no está configurada en este servidor.", "ai_not_configured");
  }
  if (!client) {
    client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      baseURL: env.ANTHROPIC_BASE_URL,
      maxRetries: 2,
      timeout: 120_000,
      defaultHeaders: env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : undefined,
    });
  }
  return client;
}

export const MODEL = env.AI_MODEL;

export type AiPurpose =
  | "tutor_chat"
  | "alert_detection"
  | "file_extraction"
  | "activity_draft"
  | "class_proposals"
  | "rubric_proposal"
  | "rubric_import"
  | "rubric_assessment"
  | "deliverable_analysis"
  | "aspect_analysis"
  | "change_request"
  | "reflection_questions"
  | "session_summary"
  | "thinking_xray"
  | "report_narrative"
  | "health_check";

export interface UsageContext {
  purpose: AiPurpose;
  teacherId: string | null;
  activityId?: string | null;
}

/** Turns SDK errors into user-facing messages (and logs the technical detail). */
export function aiError(err: unknown, ctx: UsageContext): HttpError {
  if (err instanceof HttpError) return err;
  log.error("ai_call_failed", { purpose: ctx.purpose, ...errorFields(err), status: (err as { status?: number }).status });
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(503, "La IA está recibiendo muchas solicitudes. Probá de nuevo en un minuto.", "ai_busy");
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(503, "La IA no está disponible por un problema de configuración del servidor.", "ai_config");
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A missing/invalid workspace id or key surfaces as a 400 on every request: that is configuration.
    // Any other 400 is about this request (its content), not about the server.
    const detail = String((err as Error).message ?? "").toLowerCase();
    if (/workspace|api[ _-]?key|authentication|credential|permission/.test(detail)) {
      return new HttpError(503, "La IA no está disponible por un problema de configuración del servidor.", "ai_config");
    }
    // The API blocks answers that would copy protected text word for word (a page of a published
    // textbook). Transcription retries asking for notes in its own words (services/extract.ts).
    if (/content filtering/.test(detail)) {
      return new HttpError(502, "La IA no puede copiar este texto tal cual (parece de un libro publicado). Probá con otro material.", "ai_content_filtered");
    }
    return new HttpError(502, "La IA no pudo procesar este pedido. Probá de nuevo; si vuelve a pasar, probá con otro material o avisanos.", "ai_rejected");
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
    return new HttpError(503, "No pudimos comunicarnos con la IA. Probá de nuevo en unos segundos.", "ai_unreachable");
  }
  return new HttpError(503, "La IA no pudo responder. Probá de nuevo en unos segundos.", "ai_failed");
}

const startOfDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

// Cost in USD from the stored token counts (input_tokens includes cache reads/writes).
const u = schema.aiUsage;
// Prices are code constants (not user input), inlined as numeric literals so Postgres
// can type the arithmetic.
const price = (v: number) => sql.raw(Number(v).toFixed(6));
const COST_SQL = sql<number>`coalesce(sum(
  greatest(${u.inputTokens} - ${u.cacheReadTokens} - ${u.cacheWriteTokens}, 0) * ${price(AI_PRICES_PER_MTOK.input)}
  + ${u.cacheWriteTokens} * ${price(AI_PRICES_PER_MTOK.cacheWrite)}
  + ${u.cacheReadTokens} * ${price(AI_PRICES_PER_MTOK.cacheRead)}
  + ${u.outputTokens} * ${price(AI_PRICES_PER_MTOK.output)}
) / 1000000.0, 0)::float`;

let globalSpend: { at: number; usd: number } | null = null;

/** Tests only: forget the cached service-wide spend. */
export function resetAiSpendCache() {
  globalSpend = null;
}

async function spentTodayGlobal(): Promise<number> {
  if (globalSpend && Date.now() - globalSpend.at < 30_000) return globalSpend.usd;
  const [row] = await db.select({ usd: COST_SQL }).from(u).where(gte(u.createdAt, startOfDay()));
  globalSpend = { at: Date.now(), usd: Number(row?.usd ?? 0) };
  return globalSpend.usd;
}

export async function spentTodayByWorkspace(teacherId: string): Promise<number> {
  const [row] = await db.select({ usd: COST_SQL }).from(u).where(and(eq(u.teacherId, teacherId), gte(u.createdAt, startOfDay())));
  return Number(row?.usd ?? 0);
}

/** Throws when today's AI spending cap (whole service or this workspace) was reached. */
export async function assertBudget(teacherId: string | null): Promise<void> {
  if ((await spentTodayGlobal()) >= env.AI_DAILY_USD_GLOBAL) {
    throw new HttpError(503, "El servicio alcanzó su límite diario de uso de IA. Se renueva a las 21 h (hora de Argentina).", "ai_quota_global");
  }
  if (!teacherId) return;
  if ((await spentTodayByWorkspace(teacherId)) >= env.AI_DAILY_USD_PER_WORKSPACE) {
    throw new HttpError(
      429,
      "Este espacio alcanzó el límite diario de uso de IA. Se renueva a las 21 h (hora de Argentina).",
      "ai_quota",
    );
  }
}

export async function recordUsage(ctx: UsageContext, usage: Partial<Anthropic.Usage> | null | undefined, ok = true) {
  try {
    await db.insert(schema.aiUsage).values({
      teacherId: ctx.teacherId,
      activityId: ctx.activityId ?? null,
      purpose: ctx.purpose,
      model: MODEL,
      inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      ok,
    });
  } catch (err) {
    log.warn("ai_usage_record_failed", errorFields(err));
  }
}

export type UserContent = string | Anthropic.ContentBlockParam[];

export interface StructuredRequest<S extends z.ZodType> extends UsageContext {
  system: string;
  content: UserContent;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

/**
 * Schema-validated JSON from Claude (structured outputs). The result still goes through
 * the domain sanitizers before it is stored: the model is never trusted blindly.
 */
export async function generateStructured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
  await assertBudget(req.teacherId);
  let response;
  try {
    response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: req.maxTokens ?? 8000,
      system: wellFormed(req.system),
      output_config: { effort: req.effort ?? "medium", format: zodOutputFormat(req.schema) },
      messages: [{ role: "user", content: wellFormed(req.content) }],
    });
  } catch (err) {
    await recordUsage(req, null, false);
    throw aiError(err, req);
  }
  await recordUsage(req, response.usage, true);
  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "La IA no pudo procesar este contenido. Revisalo y probá de nuevo.", "ai_refused");
  }
  if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
    throw new HttpError(502, "La respuesta de la IA llegó incompleta. Probá de nuevo.", "ai_incomplete");
  }
  return response.parsed_output as z.infer<S>;
}

/** Plain-text completion (used for OCR/transcription of uploaded files). */
export async function generateText(req: UsageContext & { system: string; content: UserContent; maxTokens?: number }): Promise<string> {
  await assertBudget(req.teacherId);
  let response;
  try {
    response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: req.maxTokens ?? 16000,
      system: wellFormed(req.system),
      output_config: { effort: "low" },
      messages: [{ role: "user", content: wellFormed(req.content) }],
    });
  } catch (err) {
    await recordUsage(req, null, false);
    throw aiError(err, req);
  }
  await recordUsage(req, response.usage, true);
  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "La IA no pudo procesar este contenido.", "ai_refused");
  }
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// ── Availability probe (shown to teachers as an honest banner when AI is down) ──

let lastProbe: { at: number; ok: boolean } | null = null;

export async function aiStatus(): Promise<"ok" | "not_configured" | "unavailable"> {
  if (!env.ANTHROPIC_API_KEY) return "not_configured";
  if (lastProbe && Date.now() - lastProbe.at < (lastProbe.ok ? 10 * 60_000 : 60_000)) {
    return lastProbe.ok ? "ok" : "unavailable";
  }
  try {
    const r = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 16,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Respondé solo: ok" }],
    });
    await recordUsage({ purpose: "health_check", teacherId: null }, r.usage, true);
    lastProbe = { at: Date.now(), ok: true };
  } catch (err) {
    log.warn("ai_probe_failed", { ...errorFields(err), status: (err as { status?: number }).status });
    lastProbe = { at: Date.now(), ok: false };
  }
  return lastProbe.ok ? "ok" : "unavailable";
}

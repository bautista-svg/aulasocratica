// Validated configuration. The process refuses to start with an invalid environment
// instead of failing later on the first request that needs a value.
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Uploaded files live here (a persistent volume in production). */
  DATA_DIR: z.string().default("./data"),
  /** Public origin, used for cookies (Secure), CSRF origin checks and share links. */
  PUBLIC_URL: z.string().url().default("http://localhost:5173"),
  /** Behind Traefik/Cloudflare: trust X-Forwarded-For / CF-Connecting-IP for client IPs. */
  TRUST_PROXY: bool.default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Required when the key is not scoped to a workspace (sk-ant-usr…/organization keys). */
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().default("claude-haiku-5-5"),
  /** Daily AI spending cap per teacher workspace in USD (all its students included). */
  AI_DAILY_USD_PER_WORKSPACE: z.coerce.number().positive().default(3),
  /** Daily AI spending cap for the whole service in USD (protects against mass abuse). */
  AI_DAILY_USD_GLOBAL: z.coerce.number().positive().default(40),
  /** Tutor replies per student per day in one activity. */
  AI_DAILY_REPLIES_PER_STUDENT: z.coerce.number().int().positive().default(150),
  /** Disk quota for uploaded files per teacher workspace, in MB. */
  STORAGE_QUOTA_MB_PER_WORKSPACE: z.coerce.number().int().positive().default(2048),
  /** "Continuar con Google" (OAuth web client). Both empty = the button is not shown. */
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /** Shared password for the read-only /admin overview. Empty = /admin disabled. */
  ADMIN_PASSWORD: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  // API_PORT wins over PORT so dev tooling that exports PORT for the web server does not clash.
  const parsed = schema.safeParse({ ...process.env, PORT: process.env.API_PORT ?? process.env.PORT });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.PUBLIC_URL);
    // http is only accepted for local benchmarks of the production build.
    if (!env.PUBLIC_URL.startsWith("https://") && !local) throw new Error("PUBLIC_URL debe usar https en producción");
    if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length < 16) {
      throw new Error("ADMIN_PASSWORD debe tener al menos 16 caracteres");
    }
  }
  return env;
}

export const env = load();
export const isProd = env.NODE_ENV === "production";
export const secureCookies = env.PUBLIC_URL.startsWith("https://");
export const aiConfigured = Boolean(env.ANTHROPIC_API_KEY);

// Structured JSON logs on stdout (Coolify collects them). Never log secrets, tokens,
// student messages or other personal content: log ids and counts instead.
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < threshold || process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 6).join(" | ") };
  return { error: String(err) };
}

// Helpers for integration tests: real Hono app + real Postgres (aula_test).
import { sql } from "drizzle-orm";
import { createApp } from "@server/app";
import { db } from "@server/db/client";

export const app = createApp({ staticDir: null });
const ORIGIN = "http://localhost:5173";

export async function resetDb() {
  await db.execute(sql`
    truncate table teachers, teacher_sessions, classrooms, students, tutors, activities, activity_files,
      materials, learning_sessions, student_tokens, messages, pedagogical_events, rubric_assessments,
      thinking_analyses, session_summaries, classroom_alerts, student_alerts, reports, audit_logs, ai_usage
    restart identity cascade`);
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  cookies: string[];
}

/** JSON request against the app. `cookie` is sent as-is; `origin: null` omits the Origin header. */
export async function call<T = any>(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string>; form?: FormData } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await app.request(path, { method, headers, body });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, body: parsed as T, headers: res.headers, cookies };
}

/** "as_t=abc; Path=/; …" → "as_t=abc" */
export function cookiePair(setCookies: string[], name: string): string {
  const c = setCookies.find((s) => s.startsWith(`${name}=`));
  if (!c) throw new Error(`cookie ${name} not set`);
  return c.split(";")[0]!;
}

/** Creates an anonymous teacher workspace and returns its cookie. */
export async function newTeacher(): Promise<{ cookie: string; id: string }> {
  const r = await call("POST", "/api/auth/start", { body: {} });
  if (r.status !== 201) throw new Error(`start failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { cookie: cookiePair(r.cookies, "as_t"), id: r.body.teacher.id };
}

export async function newClassroom(cookie: string, name = "5.º B"): Promise<string> {
  const r = await call("POST", "/api/classrooms", { cookie, body: { name } });
  if (r.status !== 201) throw new Error(`classroom failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.classroom.id;
}

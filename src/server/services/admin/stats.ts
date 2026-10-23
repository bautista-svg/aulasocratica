import { AI_PRICES_PER_MTOK, costUsd } from "@shared/domain/ai-cost";
// Read-only aggregates for /admin. Counts and AI usage only: no student names, no content,
// no full teacher emails (masked).
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { env } from "../../env";
import {
  AI_PRICE_PER_MTOK,
  maskEmail,
  type AdminOverview,
  type AdminUsageDay,
  type AdminWorkspace,
  type AdminWorkspacesResponse,
} from "@shared/contracts/admin";
import { isUuid } from "../access";

const TZ = "America/Argentina/Buenos_Aires";
const DAYS = 14;
export const WORKSPACES_PAGE = 25;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The last `count` calendar days in Argentina, oldest first, as YYYY-MM-DD. */
export function lastDays(count: number, now = new Date()): string[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: count }, (_, i) => new Date(base - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Cost with the cache prices (reads cost a tenth of normal input), as the daily caps count it. */
const costOf = (r: { cacheRead?: number; cacheWrite?: number } | undefined, input: number, output: number) =>
  costUsd({ inputTokens: input, outputTokens: output, cacheReadTokens: Number(r?.cacheRead ?? 0), cacheWriteTokens: Number(r?.cacheWrite ?? 0) });

export async function adminOverview(): Promise<AdminOverview> {
  const days = lastDays(DAYS);
  const since = sql`(${days[0]}::date::timestamp at time zone ${TZ})`;
  const [totalsRows, dayRows, purposeRows] = await Promise.all([
    db.execute<Record<keyof AdminOverview["totals"], number>>(sql`
      select
        (select count(*)::int from teachers) as "workspaces",
        (select count(*)::int from teachers where password_hash is not null or google_sub is not null) as "withAccount",
        (select count(*)::int from teachers where last_seen_at > now() - interval '7 days') as "active7",
        (select count(*)::int from teachers where last_seen_at > now() - interval '30 days') as "active30",
        (select count(*)::int from teachers where is_suspended) as "suspended",
        (select count(*)::int from classrooms) as "classrooms",
        (select count(*)::int from activities) as "activities",
        (select count(*)::int from activities where status = 'published') as "published",
        (select count(*)::int from learning_sessions) as "studentSessions",
        (select count(*)::int from messages where created_at > now() - interval '7 days') as "messages7"`),
    db.execute<{ day: string; calls: number; failed: number; input: number; output: number; cacheRead: number; cacheWrite: number }>(sql`
      select to_char((created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day,
        count(*)::int as calls,
        count(*) filter (where not ok)::int as failed,
        coalesce(sum(input_tokens), 0)::float8 as input,
        coalesce(sum(output_tokens), 0)::float8 as output,
        coalesce(sum(cache_read_tokens), 0)::float8 as "cacheRead",
        coalesce(sum(cache_write_tokens), 0)::float8 as "cacheWrite"
      from ai_usage
      where created_at >= ${since}
      group by 1
      order by 1`),
    db.execute<{ purpose: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }>(sql`
      select purpose, count(*)::int as calls,
        coalesce(sum(input_tokens), 0)::float8 as input,
        coalesce(sum(output_tokens), 0)::float8 as output,
        coalesce(sum(cache_read_tokens), 0)::float8 as "cacheRead",
        coalesce(sum(cache_write_tokens), 0)::float8 as "cacheWrite"
      from ai_usage
      where created_at >= ${since}
      group by purpose
      order by sum(input_tokens + output_tokens) desc`),
  ]);

  const byDay = new Map(Array.from(dayRows).map((r) => [r.day, r]));
  const dayList: AdminUsageDay[] = days.map((day) => {
    const r = byDay.get(day);
    const input = Number(r?.input ?? 0);
    const output = Number(r?.output ?? 0);
    return {
      day,
      calls: r?.calls ?? 0,
      failed: r?.failed ?? 0,
      inputTokens: input,
      outputTokens: output,
      costUsd: round4(costOf(r, input, output)),
    };
  });
  const byPurpose = Array.from(purposeRows).map((r) => ({
    purpose: r.purpose,
    calls: r.calls,
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    cacheReadTokens: Number(r.cacheRead),
    costUsd: round4(costOf(r, Number(r.input), Number(r.output))),
  }));
  const totals = Array.from(totalsRows)[0]!;
  return {
    totals,
    ai: {
      days: dayList,
      byPurpose,
      totalCostUsd: round4(dayList.reduce((n, d) => n + d.costUsd, 0)),
      pricePerMTok: { ...AI_PRICE_PER_MTOK },
      dailyUsdPerWorkspace: env.AI_DAILY_USD_PER_WORKSPACE,
      dailyUsdGlobal: env.AI_DAILY_USD_GLOBAL,
    },
  };
}

type WorkspaceRow = {
  id: string;
  created_at: Date | string;
  cursor_ts: string;
  last_seen_at: Date | string;
  email: string | null;
  has_account: boolean;
  is_suspended: boolean;
  classrooms: number;
  activities: number;
  sessions: number;
  ai_today: number;
};

function decodeCursor(raw: string | undefined): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string" || !isUuid(parsed.i)) return null;
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(parsed.t)) return null;
    return { ts: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}

const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify({ t: ts, i: id })).toString("base64url");

/** Newest first, 25 per page. The cursor keeps microsecond precision (Postgres text, not JS Date). */
export async function adminWorkspaces(cursorRaw: string | undefined): Promise<AdminWorkspacesResponse> {
  const cursor = decodeCursor(cursorRaw);
  // Same "day" as the AI quota (assertBudget): UTC midnight.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rows = await db.execute<WorkspaceRow>(sql`
    select t.id, t.created_at, t.last_seen_at, t.email, t.is_suspended,
      to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_ts,
      (t.password_hash is not null or t.google_sub is not null) as has_account,
      (select count(*)::int from classrooms c where c.teacher_id = t.id) as classrooms,
      (select count(*)::int from activities a where a.teacher_id = t.id) as activities,
      (select count(*)::int from learning_sessions ls join activities a on a.id = ls.activity_id where a.teacher_id = t.id) as sessions,
      (select coalesce(sum(greatest(u.input_tokens - u.cache_read_tokens - u.cache_write_tokens, 0) * ${sql.raw(String(AI_PRICES_PER_MTOK.input))}
           + u.cache_write_tokens * ${sql.raw(String(AI_PRICES_PER_MTOK.cacheWrite))} + u.cache_read_tokens * ${sql.raw(String(AI_PRICES_PER_MTOK.cacheRead))}
           + u.output_tokens * ${sql.raw(String(AI_PRICES_PER_MTOK.output))}) / 1000000.0, 0)::float8 from ai_usage u
         where u.teacher_id = t.id and u.created_at >= ${dayStart.toISOString()}::timestamptz) as ai_today
    from teachers t
    ${cursor ? sql`where (t.created_at, t.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by t.created_at desc, t.id desc
    limit ${WORKSPACES_PAGE + 1}`);
  const list = Array.from(rows);
  const page = list.slice(0, WORKSPACES_PAGE);
  const iso = (v: Date | string) => new Date(v).toISOString();
  const workspaces: AdminWorkspace[] = page.map((r) => ({
    id: r.id,
    shortId: r.id.slice(0, 8),
    createdAt: iso(r.created_at),
    lastSeenAt: iso(r.last_seen_at),
    hasAccount: r.has_account,
    maskedEmail: maskEmail(r.email),
    classrooms: r.classrooms,
    activities: r.activities,
    studentSessions: r.sessions,
    aiUsdToday: Number(r.ai_today),
    suspended: r.is_suspended,
  }));
  const last = page.at(-1);
  return { workspaces, nextCursor: list.length > WORKSPACES_PAGE && last ? encodeCursor(last.cursor_ts, last.id) : null };
}

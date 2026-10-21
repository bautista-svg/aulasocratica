import { z } from "zod";

export const adminLoginBody = z.object({
  password: z.string().min(1, "Escribí la contraseña.").max(200, "La contraseña es demasiado larga."),
});

/**
 * AI price used for the cost ESTIMATE shown in /admin (USD per million tokens). The real
 * bill depends on the provider's current prices, caching and taxes.
 */
export const AI_PRICE_PER_MTOK = { input: 0.1, output: 0.5 } as const;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * AI_PRICE_PER_MTOK.input + outputTokens * AI_PRICE_PER_MTOK.output) / 1_000_000;
}

export interface AdminSessionResponse {
  authenticated: boolean;
}

export interface AdminUsageDay {
  /** YYYY-MM-DD in Argentina's time zone. */
  day: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AdminUsagePurpose {
  purpose: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AdminOverview {
  totals: {
    workspaces: number;
    withAccount: number;
    active7: number;
    active30: number;
    suspended: number;
    classrooms: number;
    activities: number;
    published: number;
    studentSessions: number;
    messages7: number;
  };
  ai: {
    days: AdminUsageDay[];
    byPurpose: AdminUsagePurpose[];
    totalCostUsd: number;
    pricePerMTok: { input: number; output: number };
    dailyUsdPerWorkspace: number;
    dailyUsdGlobal: number;
  };
}

export interface AdminWorkspace {
  id: string;
  shortId: string;
  createdAt: string;
  lastSeenAt: string;
  hasAccount: boolean;
  /** e.g. "a***@d***.com" — never the full address. */
  maskedEmail: string | null;
  classrooms: number;
  activities: number;
  studentSessions: number;
  /** Estimated AI spending today in USD (same formula as the daily cap). */
  aiUsdToday: number;
  suspended: boolean;
}

export interface AdminWorkspacesResponse {
  workspaces: AdminWorkspace[];
  nextCursor: string | null;
}

/** "ana.perez@escuela.edu.ar" → "a***@e***.ar" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${domain[0] ?? ""}***${tld}`;
}

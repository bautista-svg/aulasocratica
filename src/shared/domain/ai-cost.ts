// Prices of the model in use (Claude Haiku 5.5, prompts up to 100K tokens), USD per million
// tokens. Used for the daily spending caps and the cost estimate in /admin.
export const AI_PRICES_PER_MTOK = {
  input: 0.1,
  cacheWrite: 0.125,
  cacheRead: 0.01,
  output: 0.5,
} as const;

export interface UsageTokens {
  /** Total input tokens INCLUDING cache reads and writes (as stored in ai_usage.input_tokens). */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export function costUsd(u: UsageTokens): number {
  const uncached = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
  return (
    (uncached * AI_PRICES_PER_MTOK.input +
      u.cacheWriteTokens * AI_PRICES_PER_MTOK.cacheWrite +
      u.cacheReadTokens * AI_PRICES_PER_MTOK.cacheRead +
      u.outputTokens * AI_PRICES_PER_MTOK.output) /
    1_000_000
  );
}

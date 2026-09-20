/**
 * Cost per scan, from actual usage. Prices here are list prices copied by
 * hand and WILL drift — check them against the providers' pricing pages when
 * the date below is more than a couple of months old. They are for showing
 * the user roughly what a scan costs, not for invoicing.
 */

export const PRICING_AS_OF = "2026-09-20";

/** Anthropic first-party API, USD per million tokens. */
export const CLAUDE_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Google Document AI Enterprise Document OCR, USD per page (≈ $1.50 / 1,000). Approximate. */
export const DOCAI_USD_PER_PAGE = 0.0015;

/** Display only. Fixed on purpose; a live rate would be false precision. */
export const JPY_PER_USD = 150;

export interface Usage {
  pages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Cost {
  ocr_usd: number;
  llm_usd: number;
  total_usd: number;
  total_jpy: number;
  tokens: number;
  model: string;
  pricing_as_of: string;
}

export function estimateCost(model: string, u: Usage): Cost {
  const p = CLAUDE_PRICES[model] ?? CLAUDE_PRICES["claude-opus-5"];
  const llm =
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite) /
    1_000_000;
  const ocr = u.pages * DOCAI_USD_PER_PAGE;
  const total = ocr + llm;
  return {
    ocr_usd: round(ocr, 6),
    llm_usd: round(llm, 6),
    total_usd: round(total, 6),
    total_jpy: round(total * JPY_PER_USD, 2),
    tokens: u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0),
    model,
    pricing_as_of: PRICING_AS_OF,
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

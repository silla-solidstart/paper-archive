import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, CLAUDE_PRICES, DOCAI_USD_PER_PAGE, JPY_PER_USD } from "../src/pricing.ts";

test("estimateCost: pages and tokens priced per the tables, yen is display-only", () => {
  const c = estimateCost("claude-opus-5", { pages: 6, inputTokens: 4000, outputTokens: 500 });
  const p = CLAUDE_PRICES["claude-opus-5"];
  const llm = (4000 * p.input + 500 * p.output) / 1e6;
  const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
  near(c.ocr_usd, 6 * DOCAI_USD_PER_PAGE);
  near(c.llm_usd, llm);
  near(c.total_usd, llm + 6 * DOCAI_USD_PER_PAGE);
  near(c.total_jpy, c.total_usd * JPY_PER_USD, 0.01); // yen is rounded to 2 dp
  assert.equal(c.tokens, 4500);
  assert.equal(c.model, "claude-opus-5");
});

test("estimateCost: cache tokens are priced separately, unknown model falls back to Opus", () => {
  const a = estimateCost("claude-opus-5", { pages: 1, inputTokens: 100, outputTokens: 100, cacheReadTokens: 10000 });
  const b = estimateCost("claude-opus-5", { pages: 1, inputTokens: 100, outputTokens: 100 });
  assert.ok(a.llm_usd > b.llm_usd);
  assert.equal(a.tokens, 10200);
  assert.deepEqual(
    estimateCost("not-a-model", { pages: 1, inputTokens: 1, outputTokens: 1 }).llm_usd,
    estimateCost("claude-opus-5", { pages: 1, inputTokens: 1, outputTokens: 1 }).llm_usd,
  );
});

test("a typical single-photo scan lands in the few-yen range", () => {
  const c = estimateCost("claude-opus-5", { pages: 1, inputTokens: 3500, outputTokens: 600 });
  assert.ok(c.total_jpy > 1 && c.total_jpy < 20, `got ¥${c.total_jpy}`);
});

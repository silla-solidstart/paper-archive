# Cost model and pricing inputs

Live numbers: `GET /api/costs` (bearer token) summarises the `scan_costs` ledger — every
attempt, including failures after OCR. This page is the reasoning around those numbers.
Prices are list prices as of **2026-09-20** (`src/pricing.ts`); FX fixed at ¥150/US$.

## Measured (2026-09-20, claude-opus-5, Enterprise OCR)

| Input | OCR | LLM in / out tokens | LLM | Total | Time |
|---|---|---|---|---|---|
| 1-page photo-like JPEG (1555×2200) | $0.0015 | 7,347 / 332 | $0.0450 | **$0.0465 ≈ ¥7.0** | 8.7 s |
| 6-page text PDF | $0.0090 | 6,890 / 760 | $0.0535 | $0.0625 ≈ ¥9.4 | 14.8 s |

Read: the photo path costs more per page than the PDF path because the image itself is
sent to the model. Roughly 5,500 of the photo's 7,347 input tokens are the image —
about **¥4 of the ¥7**. OCR is negligible (¥0.2/page). Output is small.

Caveat: two non-representative documents. Real 納税通知書 photos will have less text
(fewer OCR tokens) but the same image cost. Expect **¥5–8 per photo** on Opus 5 until
the eval harness says otherwise.

## Variable cost per scan, by model (photo path, same token counts)

| Model | Approx. per photo | Notes |
|---|---|---|
| claude-opus-5 | **¥7.0** | measured; default; best on hard Japanese layouts |
| claude-sonnet-5 | ≈ ¥2.9 | 40% of Opus at list price; A/B on the real corpus first |
| claude-haiku-4-5 | ≈ ¥1.5 | 20%; likely too weak for 和暦 / vertical-text edge cases |

Levers, in order of size:
1. **Image tokens** (~60% of the photo cost). Test on the real corpus: (a) 1568 px long edge
   instead of 2200 — the PWA's `MAX_EDGE`; (b) text-only extraction for document types
   where OCR text is sufficient. Both are one-line experiments with `scripts/eval-extract.ts`.
2. **Model** — Sonnet 5 if accuracy holds on the Japanese corpus. Store `extraction_model`
   per document (already done) so a switch is measurable.
3. Prompt caching does not help yet: the system prompt is below the cacheable minimum.

## Fixed costs (monthly, approximate)

| Item | Now | When it grows |
|---|---|---|
| Cloudflare Workers + custom domain | ¥0 (free: 100k req/day) | $5/mo Workers Paid |
| Neon Postgres | ¥0 (free tier) | ~$19/mo Launch |
| GCP Secret Manager | < ¥100 | same |
| Google Drive storage | ¥0 — it is the user's own Drive | never |
| Domain | already owned | — |
| **Total** | **≈ ¥0–100** | ≈ ¥3,600 at $24 |

So until real scale, the business is almost entirely variable cost: **≈ ¥7 per photo**.

## Per-user cost per month (Opus 5, ¥7/photo)

| Scans / month | Variable cost | With Sonnet 5 |
|---|---|---|
| 5 (free tier) | ¥35 | ¥15 |
| 20 | ¥140 | ¥58 |
| 50 | ¥350 | ¥145 |
| 100 | ¥700 | ¥290 |

Card fees (Stripe Japan ≈ 3.6%) and a support/dev allowance are on top.

## Pricing inputs, not a decision

For a subscription with N included scans, gross margin on variable cost is
`1 − (N × ¥7) / price`. Some points on that curve, Opus 5:

| Plan | Included | Cost | Margin on variable |
|---|---|---|---|
| ¥480 | 20 | ¥140 | 71% |
| ¥980 | 50 | ¥350 | 64% |
| ¥980 | 50, Sonnet 5 | ¥145 | 85% |
| Overage | per scan | ¥7 | at ¥20/scan, 65% |

A free tier of 5 scans/month costs ≈ ¥35 per free user per month — cheap acquisition if
conversion is even a few percent. Household mail volume in Japan is typically 10–40
items a month, so 20–50 included scans covers most users; the 100+ segment is
small-business 領収書 volume, which is a different product (電子帳簿保存法 compliance).

What to do before setting a price: run 30–50 real documents through
`scripts/eval-extract.ts` with Opus 5 and Sonnet 5, compare accuracy, and read
`/api/costs`. The right price depends on which model survives that test.

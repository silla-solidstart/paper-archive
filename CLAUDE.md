# AI Paper Archive

Scan physical mail and paperwork, understand it, file it in the user's own Google
Drive, and tell them whether they still need the original.

Source of truth for scope and decisions: `docs/project-context.pdf` (product brief +
18 Sep 2026 discussion notes). Read it before changing architecture.

## Non-negotiable decisions

These were decided deliberately. Do not revisit them without the user saying so.

- **Document AI is the OCR source of truth.** An LLM never performs OCR. Document AI
  answers "what text is on this page?"; the LLM answers "what does this document mean?"
- **Store raw OCR text and the AI interpretation separately.** The model output is
  never the only representation of a document.
- **Originals live in the user's Google Drive, not our storage.** This is the trust
  proposition, not an implementation detail.
- **`drive.file` scope only.** Never request broader Drive access. It is the one Drive
  scope Google treats as non-sensitive, which is what keeps us out of the verification
  process. The app can only see files it created, so the "Paper Archive" folder ID must
  be persisted in Postgres — it cannot be searched for later.
- **Postgres is the filing system.** Drive folders are for human convenience only.
- **Retention advice is conservative.** Never tell a user an original is safe to discard
  unless that can genuinely be established. "Unsure — user review required" is a correct
  answer.
- **Extraction happens at ingest, not at query time.** MCP is a third consumer of the
  index, alongside the PWA and search — not a replacement for extraction.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Static HTML PWA in `public/`, served by Workers assets. The brief proposed Next.js; one page has not needed it. |
| Backend | Cloudflare Workers |
| Temp storage | None. The owner's Drive holds the original from the first second (see "Drive first"). |
| Permanent storage | User's Google Drive |
| Database | Neon Postgres |
| OCR | Google Document AI — Enterprise Document OCR |
| Understanding | Claude (`claude-opus-5`), structured outputs, image + OCR text in |
| Search | Postgres (see Japanese caveat below) → pgvector later |

Pipeline: `Upload → Drive (original) → OCR → AI extraction → Index → rename in Drive → Done`.
Each stage must be independently retryable; Document AI, Claude, and Drive all fail and
rate-limit in production. Anything after the Drive step can be re-run later ("Re-analyze").

## Known traps

- **Japanese full-text search does not work with stock Postgres FTS.** `to_tsvector` splits
  on whitespace, so 固定資産税納税通知書 becomes one meaningless token. `pgroonga`/`pg_bigm`
  are likely unavailable on Neon. Use `pg_trgm` or `ILIKE` for the MVP and treat real
  Japanese search as a separate project.
- **The `googleapis` Node SDK does not run on the Workers runtime.** Service-account auth
  must be hand-rolled: build a JWT, sign RS256 via Web Crypto (`crypto.subtle.importKey`
  on the PKCS8 key), exchange at `oauth2.googleapis.com/token`.
- **Claude API billing is separate from a Claude subscription.** Needs its own key and credits.
- **Japanese documents are the point.** Vertical text, 和暦 dates, municipal notice layouts,
  and 納税通知書 → "pay by X" patterns are where competitors fail. Test against real
  documents, not synthetic ones.

## Drive first (hard rule, decided 2026-09-20)

**The photo is saved to the archive owner's Google Drive before anything else
happens, byte-for-byte as sent, regardless of what OCR or the model do
afterwards.** Consequences:

- Order is Drive → OCR → understand → index → rename. A failure after the
  Drive step leaves a document with `drive_file_id` set and `status = failed`;
  the fix is *Re-analyze*, never a re-scan. There is no "not in Drive" state
  for an indexed document.
- If the owner's Google grant has lapsed, the scan stops *before* OCR with
  `409 reconnect_google` (or `owner_no_drive`): nothing spent, photo still on
  the phone. Members of a shared archive are blocked until the owner signs in
  again — that is the honest consequence of "regardless".
- The "original" is the photo as the phone sends it: long edge 2200 px JPEG
  (~0.5 MB, ≈190 dpi on A4). Silla: "the document just needs to be legible";
  nothing higher buys accuracy (Claude downsizes past ~1.5k px anyway).
  No PDF wrapping, no re-encoding on the server.
- Files land as `<timestamp>.jpg` under the scan month and are renamed
  `date_issuer_title.jpg` (and moved to the document's own month) once
  extraction succeeds. A document that never got read keeps the timestamp name.
- The only dry path is `POST /api/process?dry=1` for the operator (prompt
  tuning, `scripts/eval-extract.ts`): nothing is stored anywhere, so there is
  nothing to protect.

## Access (decided 2026-09-20): invite-only

The whole app — static shell included — is behind Google sign-in. Who may sign
in = `ADMIN_EMAILS` (wrangler `[vars]`, bootstrap; always allowed, always admin,
cannot be locked out) ∪ rows in `allowed_users` (emails or `@domain`, with a
role). Admins manage the table at `#/admin`. The check runs at sign-in (no
session is created for a stranger) and on every request (removal is immediate).
Public paths: `/privacy` (Google requires it), `/health`, `/auth/*`, icons,
manifest, service worker. Space invites do not bypass the list. The bearer
token remains the operator identity (MCP, tests) and is admin.

## Spaces (decided 2026-09-20)

A **space** is the unit of sharing; every document belongs to exactly one.
**Product model (2026-09-20): every user has exactly one archive of their own,
can share it (invite link/QR), and can be in archives others shared with
them. Users cannot create additional spaces** — the API allows it only for
the operator/admin, and the UI never offers it; the UI says "archive", not
"space". Users have a current one (`users.current_space_id`); all reads and
writes scope by `space_id`. `documents.user_id` means "scanned by".

**Files live in the space owner's Google Drive**, under
`Paper Archive / <space name> / YYYY / MM /`, uploaded with the owner's grant
whoever scanned — so a space really is a folder, members never choose where
files go, and the owner is the only person whose Drive connection matters. If
the owner's grant lapses, scans still index; filing reports `reconnect_google`
and the owner re-signs in. Ownership transfer is not built yet.

Invites are capability links (`/join/<token>`, 7 days, up to 10 uses, revocable
by the owner). Accepting requires Google sign-in. The preview endpoint is
public by design: the join page shows what you are joining before sign-in.

## Japanese copy: editor pass required

No user-facing Japanese copy ships on a first draft. Run it through a dedicated
editor pass (a fresh reviewer briefed as a senior Japanese copy editor; Japanese
first, English as a counterpart, not a translation) and take its recommendation.
Supporting lines ≈ 20 characters (≤ 25); English ≤ 8 words. No abstractions that
beg a question (「忘れる」), no personification, no pipeline arrows as copy.
Adopted copy is recorded in `docs/brand.md`.

## Languages

The UI is EN / 日本語 (toggle in the header, auto-detected from the browser,
persisted per device). The same choice is sent as `X-Lang` and decides the
language the model writes `summary` and `retention_reason` in; `title` and
`issuer` are always as printed on the document; `document_type` and
`action_type` are machine values and are localised in the UI only. The
language is stored per document (`documents.lang`).

## Costs

Every scan attempt writes a row to `scan_costs` (migration 0003) — including
attempts that fail after OCR, because OCR was still paid for — and the row
survives document and user deletion. `GET /api/costs` summarises it (the
bearer token sees platform-wide; a session user sees their own). The admin
dashboard (`npm run dashboard`, localhost only, reads Neon directly) is the
operator view; it never needs deploying. Prices live
in `src/pricing.ts`, dated; check them when `PRICING_AS_OF` is stale. See
`docs/costs.md` for the pricing model.

## Brand

See `docs/brand.md`. Mark = three-card stack with envelope; type = IBM Plex Sans JP;
palette navy `#1e2a44` + vermilion `#e34234`. Regenerate with `FINAL=1 node brand/build.mjs`.

## Filing format

The bytes the phone sent, unchanged, with their own extension (`.jpg`, `.png`,
`.webp`, `.pdf`). The earlier JPEG→PDF wrapper (`src/pdf.ts`) was removed on
2026-09-20 with the Drive-first rule: what Drive holds must be the original.

## Labels (decided 2026-09-20)

Four axes on every document, all fixed machine codes localised only in the UI,
never translated copies (`src/extract.ts` owns the lists):

| Axis | Column | Values |
|---|---|---|
| Kind | `document_type` | receipt, invoice, tax_notice, utility_bill, … |
| Topic | `extracted_data.categories` | tax, utilities, education, … |
| Handling | `handling[]` | `todo` (→ To do), `expense` (→ ledger), `record`, `notice`, `noise` |
| Retention | `retention` | digital_sufficient / keep_temporarily / keep_original / unsure |

Plus `issuer_key` (short stable sender name so 東京電力エナジーパートナー and
東京電力 group; the user can set it, which sticks) and `keywords[]` (≤10
bilingual search terms — the cheap answer to cross-language search until
pgvector). `source_lang` records what the paper is printed in; `title`,
`issuer`, OCR text and line-item names stay as printed. Queries are never
translated at run time.

## Expenses (decided 2026-09-20)

`handling` containing `expense` writes one `expenses` row (merchant, date,
total, tax, currency, payment method, `expense_kind`) and best-effort
`expense_items` (name as printed, qty, unit price, amount, `category` — snacks,
groceries, alcohol, household, …). "How much on snacks in August" is
`GET /api/expense-items?month=2026-08&category=snacks` or the MCP tool
`list_expense_items`; the month view is `GET /api/spending` and `#/spending`.
Tables found in any document are kept as printed in `extracted_data.tables`.
Itemising a long receipt costs roughly ¥2–3 extra on Opus 5.

## Re-analysis (decided 2026-09-20)

`EXTRACTION_VERSION` (`src/extract.ts`) is bumped whenever the schema or
prompt changes in a way worth re-running old documents for. Every run —
ingest or re-analysis — is appended to `document_extractions` (full JSON,
model, cost) and the document row shows the latest; nothing is ever lost.
`user_overrides` marks fields the human set (`retention`, `issuer`); a re-run
fills around them. Triggers: the *Re-analyze* button on a document
(`POST /api/documents/:id/reanalyze`, original fetched from Drive, text-only
fallback when it cannot be) and `npm run reextract` for everything below the
current version (one document per request; ledgered as `kind = reanalyze`).

## What has been verified vs. only typechecked

Verified against the real service: Document AI OCR (Japanese, via user
credentials). Verified locally: the service-account JWT path (throwaway key),
every route's auth/size/type handling and the PWA assets (wrangler dev smoke
tests), and the pure logic (`npm test`). Verified 2026-09-20 end to end through the Worker with real credentials:
migration runner (pg_trgm present on the Neon plan), service-account →
Document AI, Claude structured extraction, Neon insert, recent/search
(Japanese trigram hit confirmed). OAuth exchange verified 2026-09-20 (Silla
signed in on the live site). **Never executed as of 2026-09-20:** the Drive
upload/rename/download path and extraction v2 against real paper — the first
scan after the Drive-first deploy is the test. Treat them as first-run risks.

## Secrets

GCP Secret Manager in `solidstart-paper-archive` is the single source.
`scripts/dev.sh` materialises a temporary `.dev.vars`; `scripts/sync-secrets.sh`
pushes to Cloudflare. The agent may *use* secrets through those scripts but
must not print them or read `.dev.vars` directly.

## Working agreement

- Prefer work that needs no credentials; the user holds all keys. Never commit secrets —
  they belong in gitignored `.dev.vars` / `wrangler secret`.
- Do not run anything billable (Document AI, Claude API, deploys) unattended without an
  explicit spend ceiling from the user.
- Deploys and `git push` are the user's call, not an automatic step.

## Environments

**One environment. Everything is production.** No dev/prod split, no staging — decided
deliberately for a solo project. Consequences that follow from it:

- The Google consent screen is **published**, not left in Testing. Testing-mode refresh
  tokens expire after 7 days, which is fatal for scan-and-forget.
- Migrations run against real data. Branch Neon ad hoc before a risky one, then delete
  the branch — branching is an on-demand tool here, not standing infrastructure.
- The test corpus is the user's own paperwork, so "dev data" is real personal data from
  day one. Treat it accordingly.

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
| Frontend | React/Next.js PWA (iOS + Android + desktop) |
| Backend | Cloudflare Workers |
| Temp storage | Cloudflare R2 (deferred for MVP — in-memory is fine without Workflows) |
| Permanent storage | User's Google Drive |
| Database | Neon Postgres |
| OCR | Google Document AI — Enterprise Document OCR |
| Understanding | Claude (`claude-opus-5`), structured outputs, image + OCR text in |
| Search | Postgres (see Japanese caveat below) → pgvector later |

Pipeline: `Upload → OCR → AI extraction → Validate → Generate PDF → Drive → Index → Done`.
Each stage must be independently retryable; Document AI, Claude, and Drive all fail and
rate-limit in production.

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

## Working agreement

- Prefer work that needs no credentials; the user holds all keys. Never commit secrets —
  they belong in gitignored `.dev.vars` / `wrangler secret`.
- Do not run anything billable (Document AI, Claude API, deploys) unattended without an
  explicit spend ceiling from the user.
- Deploys and `git push` are the user's call, not an automatic step.

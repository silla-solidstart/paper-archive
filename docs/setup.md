# Setup — accounts and credentials

Everything here needs a human: account creation, payment details, and OAuth consent
cannot be automated. Target: one evening, ending with four green curl checks.

Fill values into `.dev.vars` (copy from `.dev.vars.example`) as you go. Never commit it.

---

## 1. Google Cloud

`solidstart.jp` is on Google Workspace, so the organization node already exists and
projects created by that account land under it automatically.

- [x] Sign in to console.cloud.google.com **as `silla@solidstart.jp`**, in a browser
      profile separate from the personal gmail account. A project created under the
      wrong identity lands outside the org — the tell is that the consent screen later
      offers no Internal/External choice.
- [x] Confirm you hold **Organization Administrator** in IAM. Workspace super admin is
      a different role; it is usually seeded but verify it.
- [x] Create a dedicated project `paper-archive-dev`. Do not share a project with other
      business work. A separate prod project comes later.
- [x] Link a **business** billing account (tax: you want the 適格請求書, not a personal
      card receipt).
- [x] **Set a budget alert before enabling any API.** ¥3,000, email at 50/90/100%.

### Document AI (OCR)

- [x] Enable `documentai.googleapis.com`
- [x] Create a **Document OCR** processor (Enterprise variant). Region: `us`, `eu`, or
      `asia-northeast1` → `GCP_DOCAI_LOCATION`, `GCP_DOCAI_PROCESSOR_ID`
- [x] Create a service account, grant it Document AI User, download a JSON key
      → `GCP_SA_CLIENT_EMAIL`, `GCP_SA_PRIVATE_KEY`
- [ ] Keep the JSON key out of the repo. `*-service-account*.json` is gitignored.

The service account is for Document AI **only**. Drive access comes from user OAuth.
Do not use domain-wide delegation: documents belong in each user's own Drive, and
users are not on the solidstart.jp domain.

### Sign-in + Drive (same project)

- [x] Enable `drive.googleapis.com`
- [ ] Consent screen: user type **External**, then **publish to Production**. Not Internal —
      Internal restricts sign-in to solidstart.jp accounts, so no real user could ever use
      the app. And not left in Testing: Testing-mode refresh tokens expire after 7 days,
      which breaks a scan-and-forget product. Scopes here are all non-sensitive, so this
      should be a publish rather than a verification review.
- [ ] Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file`
      — and nothing more. `drive.file` is non-sensitive, which is what keeps the
      verification process off the critical path.
- [ ] Create an OAuth client ID, type **Web application**, with the redirect URI
      → `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`

## 2. Anthropic

- [ ] console.anthropic.com → API key + prepaid credits → `ANTHROPIC_API_KEY`
- [ ] Note: billed separately from any Claude subscription. A Claude Code plan grants
      no API quota.

## 3. Neon

- [ ] neon.tech, sign in with GitHub, create project → pooled connection string
      → `DATABASE_URL`
- [ ] Check the available extension list for `pg_trgm` (needed — stock FTS does not
      tokenise Japanese; see CLAUDE.md).

## 4. Cloudflare

- [ ] dash.cloudflare.com account; Workers free tier is sufficient (100k req/day)
- [ ] R2 is **not needed for the MVP** — without Workflows, images can go
      browser → Worker → Document AI in memory. Skip it; it needs a card on file even
      inside the free tier.

## 5. Local tooling

```bash
brew install node gh
npm i -g wrangler
gh auth login
```

---

## Verification — do this before writing application code

Four checks. Each failure here surfaces as a confusing error inside application code
later, which is what makes the setup evening feel like it ate a Saturday.

- [x] **Document AI**: verified 2026-09-18 — OCRd the 6-page brief PDF via Enterprise OCR
      v2.1.1 in asia-southeast1, returned 固定資産税納税通知書 / 上越市 / 令和 / 納期限 correctly.
- [ ] **Document AI via service account JWT** (the runtime path — the check above used
      user credentials): curl one photo of a Japanese document through the processor and
      read the OCR text. Requires the JWT signing path — the `googleapis` SDK does not
      run on Workers, so build the JWT and sign RS256 via Web Crypto. Write this now,
      not at midnight on Saturday.
- [ ] **App token**: `openssl rand -base64 32` → `APP_BEARER_TOKEN` in `.dev.vars`.
      Every `/api/*` and `/mcp` route fails closed without it.
- [ ] **Claude**: one request returning JSON matching the extraction schema
- [ ] **Neon**: `psql "$DATABASE_URL" -c 'select 1'`
- [ ] **Cloudflare**: hello-world Worker live on `*.workers.dev`

---## Provisioned state (2026-09-18)

Single environment. There is no dev/prod split — everything here is production.

| Resource | Value |
|---|---|
| Org | `solidstart.jp` (7833859326) |
| Project | `solidstart-paper-archive` (318291773922), under the org |
| Billing | `01B638-95C831-492E58`, JPY, org-parented, linked |
| Budget | `paper-archive`, ¥3,000, alerts at 50/90/100% |
| APIs | documentai, drive, iam, billingbudgets |
| Processor | `e362ac4f7e80f6e` @ `asia-southeast1` |
| Version | `pretrained-ocr-v2.1.1-2025-01-31` (Enterprise OCR) |
| Service account | `paper-archive-worker@solidstart-paper-archive.iam.gserviceaccount.com`, `roles/documentai.apiUser` |

**Region:** Document AI has no `asia-northeast1` (Tokyo). Available: us, eu, asia-south1,
asia-southeast1, australia-southeast1, europe-west2, europe-west3,
northamerica-northeast1, us-east7. `asia-southeast1` (Singapore) is closest to Japan and
keeps users' documents in-region. Changing region later is one API call; stored OCR is
unaffected.

**Processor version — do not leave this at the default.** New OCR processors are seeded
with `pretrained-ocr-v1.0-2020-09-23` ("Google Stable"), which is the 2020 base model, not
Enterprise Document OCR. Measured on the brief PDF:

| Version | chars | Japanese runs | 令和 read correctly |
|---|---|---|---|
| v1.0 (default) | 12,462 | 17 | **no — misread as 今和** |
| v2.1.1 (Enterprise) | 12,492 | 24 | yes |

A misread era character means a wrong year on a payment deadline. Pin the version
explicitly in config rather than trusting the processor default.

**Predecessor:** `solidstart-paper-archive-dev` (817649792332) was the first attempt and is
`DELETE_REQUESTED` as of 2026-09-18; recoverable via `gcloud projects undelete` for 30 days.


---

## Handoff — what is left, in order (2026-09-18)

Everything below needs you; nothing else does.

1. `cp .dev.vars.example .dev.vars`, then fill in, in this order:
   - `APP_BEARER_TOKEN` and `SESSION_SECRET` (`openssl rand -base64 32` each)
   - `DATABASE_URL` from Neon, then `psql "$DATABASE_URL" -f migrations/0001_init.sql`
     and check `pg_trgm` created without error
   - `ANTHROPIC_API_KEY`
   - service account key: `gcloud iam service-accounts keys create .secrets/gcp-sa.json --iam-account=paper-archive-worker@solidstart-paper-archive.iam.gserviceaccount.com`,
     then copy `client_email` → `GCP_SA_CLIENT_EMAIL` and `private_key` → `GCP_SA_PRIVATE_KEY`
     (the literal `\n` sequences in the JSON are fine as-is; the code normalises them)
2. `npx wrangler dev`, open http://localhost:8787, open the token disclosure, paste the
   bearer token, scan a real 納税通知書. This exercises OCR → Claude → Neon with no OAuth.
   **This is the first time the extraction call runs.** Expect to tune the prompt.
3. Console-only: consent screen (External, **published**) and the OAuth web client with
   redirect URIs `https://pa.solidstart.jp/auth/callback` and
   `http://localhost:8787/auth/callback`. Put client id/secret in `.dev.vars`.
4. Sign in with Google on localhost, scan again: this is the first run of the OAuth
   exchange and the Drive upload. Check `Paper Archive/2026/09/` appears in your Drive.
5. `npx wrangler secret put` for each secret, `npx wrangler deploy`, confirm
   https://pa.solidstart.jp/health. Deploy is deliberately not in the allowlist.
6. Connect the MCP server to Claude: URL `https://pa.solidstart.jp/mcp`, header
   `Authorization: Bearer <APP_BEARER_TOKEN>`. Ask it "what bills are due?".

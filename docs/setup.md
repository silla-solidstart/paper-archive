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

## Handoff — what needs you (2026-09-18, evening)

Secrets live in **GCP Secret Manager** in `solidstart-paper-archive`. `scripts/dev.sh`
pulls them into a temporary `.dev.vars` for local runs; `scripts/sync-secrets.sh` pushes
them to Cloudflare before a deploy. Nothing secret is in the repo or in a file that
survives the session. Already created there: `APP_BEARER_TOKEN`, `SESSION_SECRET`.

Run the commands below **in your own terminal, not via `!`**, so the values never enter
the Claude session transcript.

### 1. The service-account key — DONE 2026-09-20

Your org enforces `iam.managed.disableServiceAccountKeyCreation`. A project-scoped
exception (`enforce: false` on `solidstart-paper-archive` only) is in place; the
temporary `orgpolicy.policyAdmin` grant used to set it has been revoked. Key
`709637ad…` lives only in Secret Manager as `GCP_SA_KEY_JSON`. **Rotate by 2026-12-19.**
Verified the same day: `scripts/dev.sh` → JWT → Google token → Document AI OCR of the
brief PDF, through the Worker.

The sequence that was used, kept for the rotation and for the record:

```bash
ORG=7833859326; P=solidstart-paper-archive; PN=318291773922; ME=user:silla@solidstart.jp
gcloud organizations add-iam-policy-binding $ORG --member=$ME --role=roles/orgpolicy.policyAdmin
sleep 30   # IAM propagation
printf 'name: projects/%s/policies/iam.managed.disableServiceAccountKeyCreation\nspec:\n  rules:\n  - enforce: false\n' $PN > /tmp/policy.yaml
gcloud org-policies set-policy /tmp/policy.yaml --project=$P
sleep 30
gcloud iam service-accounts keys create /tmp/sa.json --iam-account=paper-archive-worker@$P.iam.gserviceaccount.com --project=$P
gcloud secrets create GCP_SA_KEY_JSON --project=$P --replication-policy=automatic --data-file=/tmp/sa.json
rm /tmp/sa.json /tmp/policy.yaml
# least privilege: the override is a one-time act
gcloud organizations remove-iam-policy-binding $ORG --member=$ME --role=roles/orgpolicy.policyAdmin
```

Rotate this key every 90 days (`keys create` → new secret version → `scripts/sync-secrets.sh`
→ delete the old key). Keys never expire on their own; that is why the policy exists.

### 2. The other secrets — DATABASE_URL and ANTHROPIC_API_KEY DONE 2026-09-20; OAuth still needed

```bash
P=solidstart-paper-archive; mk() { printf '%s' "$2" | gcloud secrets create "$1" --project=$P --replication-policy=automatic --data-file=-; }
mk DATABASE_URL        'postgres://…'                 # Neon → pooled connection string
mk ANTHROPIC_API_KEY   'sk-ant-…'                     # console.anthropic.com
```
Then the two console-only OAuth steps. Consent screen (APIs & Services → OAuth consent
screen / Google Auth platform), exact values:

| Field | Value |
|---|---|
| App name | Paper Archive |
| User support email | your solidstart.jp address |
| App logo | optional; `public/icons/icon-512.png` |
| App home page | `https://pa.solidstart.jp/` |
| Privacy policy | `https://pa.solidstart.jp/privacy` ← page exists in the repo; review the draft |
| Authorized domain | `solidstart.jp` (already Google-verified via Workspace) |
| Developer contact | your solidstart.jp address |
| User type | **External**, then **Publish** (not Testing — 7-day refresh tokens) |
| Scopes | `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive.file` |

Then the web client (Credentials → OAuth client ID → Web application) with redirect URIs
`https://pa.solidstart.jp/auth/callback` and `http://localhost:8787/auth/callback`, and:
```bash
mk GOOGLE_OAUTH_CLIENT_ID     '…apps.googleusercontent.com'
mk GOOGLE_OAUTH_CLIENT_SECRET '…'
```

### 3. Then tell the agent. It can do the rest without you:

- ~~`npm run migrate`~~ done 2026-09-20; `pg_trgm` present.
- ~~First pipeline run~~ done 2026-09-20 on the brief PDF: OCR → Claude → Neon → search, 18 s.
  Next: real 納税通知書 scans via `scripts/dev.sh` + the PWA, or a folder through
  `scripts/eval-extract.ts`. Billable; ~20 runs per session unless told otherwise.
- Sign-in and Drive filing need a browser: that first run is yours, in **Chrome**
  (Safari drops the `Secure` session cookie on `http://localhost`).
- Prompt tuning on the real corpus: put scans in a folder and run
  `node scripts/eval-extract.ts <folder>` against the dev server. One line per document,
  full responses saved for diffing between prompt versions.

### 4. Deploy

Laptop for now: `scripts/sync-secrets.sh && npx wrangler deploy` (after `npx wrangler login`
once). Then https://pa.solidstart.jp/health, sign in there, and the **phone test** — camera,
HEIC→JPEG via canvas, Add to Home Screen.

CI/CD is written (`.github/workflows/deploy.yml`: typecheck + tests + JWT self-test on
every push, deploy `main` to Cloudflare). To turn it on: create the GitHub repo
(github.com/new → `paper-archive`, private, empty; the SSH key is already authorised), push,
and add repo secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and
`CLOUDFLARE_ACCOUNT_ID`. Worker secrets stay in Cloudflare, set once by the sync script.

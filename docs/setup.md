# Setup — accounts and credentials

Everything here needs a human: account creation, payment details, and OAuth consent
cannot be automated. Target: one evening, ending with four green curl checks.

Fill values into `.dev.vars` (copy from `.dev.vars.example`) as you go. Never commit it.

---

## 1. Google Cloud

`solidstart.jp` is on Google Workspace, so the organization node already exists and
projects created by that account land under it automatically.

- [ ] Sign in to console.cloud.google.com **as `silla@solidstart.jp`**, in a browser
      profile separate from the personal gmail account. A project created under the
      wrong identity lands outside the org — the tell is that the consent screen later
      offers no Internal/External choice.
- [ ] Confirm you hold **Organization Administrator** in IAM. Workspace super admin is
      a different role; it is usually seeded but verify it.
- [ ] Create a dedicated project `paper-archive-dev`. Do not share a project with other
      business work. A separate prod project comes later.
- [ ] Link a **business** billing account (tax: you want the 適格請求書, not a personal
      card receipt).
- [ ] **Set a budget alert before enabling any API.** ¥3,000, email at 50/90/100%.

### Document AI (OCR)

- [ ] Enable `documentai.googleapis.com`
- [ ] Create a **Document OCR** processor (Enterprise variant). Region: `us`, `eu`, or
      `asia-northeast1` → `GCP_DOCAI_LOCATION`, `GCP_DOCAI_PROCESSOR_ID`
- [ ] Create a service account, grant it Document AI User, download a JSON key
      → `GCP_SA_CLIENT_EMAIL`, `GCP_SA_PRIVATE_KEY`
- [ ] Keep the JSON key out of the repo. `*-service-account*.json` is gitignored.

The service account is for Document AI **only**. Drive access comes from user OAuth.
Do not use domain-wide delegation: documents belong in each user's own Drive, and
users are not on the solidstart.jp domain.

### Sign-in + Drive (same project)

- [ ] Enable `drive.googleapis.com`
- [ ] Consent screen: user type **External**, status **Testing**. Not Internal —
      Internal restricts sign-in to solidstart.jp accounts, so no real user could ever
      use the app. Testing allows 100 test users with no verification review.
- [ ] Add yourself as a test user
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

- [ ] **Document AI**: curl one photo of a Japanese document through the processor and
      read the OCR text. Requires the JWT signing path — the `googleapis` SDK does not
      run on Workers, so build the JWT and sign RS256 via Web Crypto. Write this now,
      not at midnight on Saturday.
- [ ] **Claude**: one request returning JSON matching the extraction schema
- [ ] **Neon**: `psql "$DATABASE_URL" -c 'select 1'`
- [ ] **Cloudflare**: hello-world Worker live on `*.workers.dev`

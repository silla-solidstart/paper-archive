# Deployment

**How it deploys:** GitHub Actions. A push to `main` runs typecheck + tests + the JWT
self-test, then applies pending database migrations, then `wrangler deploy` to
Cloudflare Workers on `pa.solidstart.jp`, then curls `/health`. Merging to `main` is the
human step; nothing deploys on its own.

Until the GitHub repo exists, the laptop path works the same way by hand (bottom).

## Three kinds of secrets, three places

| What | Where it lives | Who puts it there |
|---|---|---|
| App runtime secrets (Anthropic key, DB, Google OAuth, SA key, bearer, session) | **Cloudflare Worker secrets** | `scripts/sync-secrets.sh`, from GCP Secret Manager — once, and on rotation |
| Source of truth for the above | **GCP Secret Manager** (`solidstart-paper-archive`) | you, from your terminal (see `docs/setup.md`) |
| CI credentials | **none** — CI authenticates to GCP keylessly (GitHub OIDC → Workload Identity Federation) and reads Secret Manager | set up 2026-09-20 |

The Worker never reads Secret Manager at runtime; Cloudflare holds a copy. That is why
`sync-secrets.sh` exists and why rotating a key is "new version in Secret Manager →
run the sync script".

## One-time setup

1. **Repo.** github.com/new → `paper-archive`, private, no README. Then locally:
   `git push -u origin main` (the SSH alias `github.com-solidstart` is already authorised).

2. **Cloudflare API token.** dash.cloudflare.com → My Profile → API Tokens → Create →
   template **Edit Cloudflare Workers**, scoped to the `solidstart.jp` zone and your
   account, **plus Zone → DNS → Edit** on `solidstart.jp` (the custom domain needs it).
   Put it in Secret Manager — the only place it lives:
   ```bash
   printf '%s' '<token>' | gcloud secrets create CLOUDFLARE_API_TOKEN --project=solidstart-paper-archive --replication-policy=automatic --data-file=-
   ```

3. **GitHub secrets: none.** The deploy job gets a GitHub OIDC token, exchanges it at
   Google's Workload Identity pool `github` (provider locked to
   `silla-solidstart/paper-archive`), impersonates `paper-archive-ci@…` — a service
   account whose only role is `secretmanager.secretAccessor` — and reads `DATABASE_URL`
   and `CLOUDFLARE_API_TOKEN` from Secret Manager at run time. The account id is not a
   secret and is written into the workflow. If you ever rename the repo, update the
   provider's attribute condition.

4. **Worker secrets, once:** `scripts/sync-secrets.sh`. It authenticates to Cloudflare with the
   token from Secret Manager; no `wrangler login` needed.

5. **First deploy** can be from the laptop (below) or by pushing to `main`.

6. Create the GitHub **environment** `production` (Settings → Environments) if you want a
   required-reviewer gate; the workflow references it and works without one.

## Every deploy after that

`git push origin main`. Watch the Actions tab. The workflow:

- fails fast on a type error or a failing test — nothing is deployed;
- applies only migrations not yet in `schema_migrations`, before the new code serves;
- cancels an older in-flight deploy if a newer push arrives;
- fails if `https://pa.solidstart.jp/health` is not 200 within ~30 s.

Rollback: `git revert` the commit and push. Cloudflare also keeps previous Worker
versions (Workers → paper-archive → Deployments → roll back) for an instant revert of the
code — but not of a migration, so keep migrations additive.

## From the laptop (until CI exists, and for emergencies)

```bash
npm run typecheck && npm test
npm run migrate                                            # DATABASE_URL from Secret Manager
scripts/sync-secrets.sh                                    # only when secrets changed
CLOUDFLARE_API_TOKEN="$(gcloud secrets versions access latest --secret=CLOUDFLARE_API_TOKEN --project=solidstart-paper-archive)" \
CLOUDFLARE_ACCOUNT_ID=3a39a7add76ceae12541aa5e110afde0 npx wrangler deploy
curl -fsS https://pa.solidstart.jp/health
```

`wrangler deploy` is deliberately not in the agent's allowlist. It is yours.

## What is not deployed

- The **admin cost dashboard** (`npm run dashboard`) is local-only and reads Neon
  directly. It has no auth of its own, which is why it binds to 127.0.0.1 and is never
  deployed.
- **Secret Manager** stays in GCP; Cloudflare gets copies.

## Environments

There is one: production. See `CLAUDE.md` § Environments. Local development runs the
same code against the same database via `scripts/dev.sh` — treat it accordingly.

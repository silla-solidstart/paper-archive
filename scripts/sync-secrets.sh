#!/usr/bin/env bash
# Push every secret from GCP Secret Manager into the deployed Worker.
# Run before `npx wrangler deploy`. Values are piped, never printed.
#
# Deliberately not in the agent allowlist: production secrets are a human step.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=solidstart-paper-archive
get() { gcloud secrets versions access latest --secret="$1" --project="$PROJECT"; }

for name in APP_BEARER_TOKEN SESSION_SECRET ANTHROPIC_API_KEY DATABASE_URL \
            GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
  get "$name" | npx wrangler secret put "$name"
done

sa="$(get GCP_SA_KEY_JSON)"
printf '%s' "$sa" | python3 -c 'import json,sys; print(json.load(sys.stdin)["client_email"], end="")' \
  | npx wrangler secret put GCP_SA_CLIENT_EMAIL
printf '%s' "$sa" | python3 -c 'import json,sys; print(json.load(sys.stdin)["private_key"], end="")' \
  | npx wrangler secret put GCP_SA_PRIVATE_KEY

echo "secrets synced; now: npx wrangler deploy"

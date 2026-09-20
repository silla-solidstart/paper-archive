#!/usr/bin/env bash
# Local dev with secrets from GCP Secret Manager.
#
# Pulls every secret that exists into a mode-600, gitignored .dev.vars, runs
# wrangler dev, and removes the file on exit. Nothing is printed. Secrets that
# do not exist yet are simply omitted, and the Worker fails closed for the
# routes that need them.
#
#   scripts/dev.sh              # http://localhost:8787
#   PORT=8790 scripts/dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=solidstart-paper-archive
PORT="${PORT:-8787}"

get() { gcloud secrets versions access latest --secret="$1" --project="$PROJECT" 2>/dev/null || true; }

# dotenv double-quoted value: escape backslash and double quote.
quote() { local v="${1//\\/\\\\}"; v="${v//\"/\\\"}"; printf '"%s"' "$v"; }

umask 077
: > .dev.vars
trap 'rm -f .dev.vars' EXIT

loaded=()
for name in APP_BEARER_TOKEN SESSION_SECRET ANTHROPIC_API_KEY DATABASE_URL \
            GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET; do
  v="$(get "$name")"
  if [ -n "$v" ]; then
    printf '%s=%s\n' "$name" "$(quote "$v")" >> .dev.vars
    loaded+=("$name")
  fi
done

# The service-account JSON becomes two vars. The private key is written on one
# line with literal \n; google-auth.ts normalises either form.
sa="$(get GCP_SA_KEY_JSON)"
if [ -n "$sa" ]; then
  printf '%s' "$sa" | python3 -c '
import json, sys
k = json.load(sys.stdin)
print("GCP_SA_CLIENT_EMAIL=\"" + k["client_email"] + "\"")
print("GCP_SA_PRIVATE_KEY=\"" + k["private_key"].replace("\n", "\\n") + "\"")
' >> .dev.vars
  loaded+=(GCP_SA_CLIENT_EMAIL GCP_SA_PRIVATE_KEY)
fi

printf 'GOOGLE_OAUTH_REDIRECT_URI="http://localhost:%s/auth/callback"\n' "$PORT" >> .dev.vars
printf 'ADMIN_EMAILS="silla@solidstart.jp"\n' >> .dev.vars

echo "loaded: ${loaded[*]:-none}"
echo "wrangler dev on http://localhost:$PORT"
npx wrangler dev --port "$PORT" "$@"

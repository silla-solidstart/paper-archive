# AI Paper Archive

Scan physical mail → understand it → file it in your own Google Drive → know whether
you can throw the original away.

See `CLAUDE.md` for architecture decisions and `docs/project-context.pdf` for the
full brief.

## Setup

Requires accounts: Google Cloud (Document AI + OAuth), Anthropic API, Neon, Cloudflare.
See [docs/setup.md](docs/setup.md).

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in credentials — never commit this
npx wrangler dev                 # http://localhost:8787
```

Everything under `/api/*` and `/mcp` requires `Authorization: Bearer $APP_BEARER_TOKEN`.

```bash
# OCR + extraction on a real document (stores it when DATABASE_URL is set)
curl -X POST localhost:8787/api/process \
  -H "Authorization: Bearer $APP_BEARER_TOKEN" \
  -H "Content-Type: image/jpeg" --data-binary @scan.jpg

# Inbox
curl localhost:8787/api/recent -H "Authorization: Bearer $APP_BEARER_TOKEN"
```

MCP endpoint for Claude and other assistants: `POST /mcp` (Streamable HTTP, stateless),
same bearer token. Tools: `search_documents`, `get_document`, `list_actions`.

## Verify the service-account crypto without credentials

```bash
node scripts/verify-jwt.ts
```

Generates a throwaway RSA key and round-trips it through the same Web Crypto
path the Worker uses, including the literal-`\n` PEM handling that env vars
introduce. Proves the signing code before the real key exists.

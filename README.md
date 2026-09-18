# AI Paper Archive

Scan physical mail → understand it → file it in your own Google Drive → know whether
you can throw the original away.

See `CLAUDE.md` for architecture decisions and `docs/project-context.pdf` for the
full brief.

## Setup

Requires accounts: Google Cloud (Document AI + OAuth), Anthropic API, Neon, Cloudflare.
See `docs/setup.md`.

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in credentials — never commit this
npx wrangler dev
```

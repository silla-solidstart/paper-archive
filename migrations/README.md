# Migrations

Plain SQL, applied in filename order.

```bash
psql "$DATABASE_URL" -f migrations/0001_init.sql
```

Neon note: `pg_trgm` must be in the project's available extension list. If it is
not, fall back to `ILIKE '%…%'` on `ocr_text` — correct but unindexed, which is
fine at MVP corpus size. Stock Postgres full-text search is not an option for
Japanese; see the note at the top of 0001.

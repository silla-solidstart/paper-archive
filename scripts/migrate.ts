/**
 * Applies migrations/*.sql in filename order against DATABASE_URL.
 *
 * psql is not installed on the dev machine, and Neon's HTTP query endpoint
 * runs one statement at a time — which breaks on dollar-quoted function
 * bodies. So this uses the driver's WebSocket Pool, which speaks the real
 * Postgres protocol and accepts a whole file as one simple query.
 *
 * DATABASE_URL comes from the environment, or from GCP Secret Manager via
 * gcloud when unset. The value is never printed.
 *
 *   npm run migrate
 */
import { Pool } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "migrations");
const PROJECT = "solidstart-paper-archive";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    return execFileSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", "--secret=DATABASE_URL", `--project=${PROJECT}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    console.error("DATABASE_URL is not set and could not be read from Secret Manager.");
    process.exit(2);
  }
}

const pool = new Pool({ connectionString: databaseUrl() });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
  );

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`  skip  ${f}`);
      continue;
    }
    const sql = readFileSync(path.join(dir, f), "utf8");
    // One simple-query round trip, inside an explicit transaction, and the
    // bookkeeping row in the same transaction so a failure applies nothing.
    await pool.query(
      `BEGIN;\n${sql}\nINSERT INTO schema_migrations (filename) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`,
    );
    console.log(`  apply ${f}`);
    ran++;
  }
  console.log(ran ? `${ran} migration(s) applied.` : "Nothing to apply.");

  // The one assumption the schema makes about the Neon plan.
  const ext = await pool.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'");
  console.log(ext.rows.length ? "pg_trgm: present" : "pg_trgm: MISSING — search will fall back to unindexed ILIKE");
} finally {
  await pool.end();
}

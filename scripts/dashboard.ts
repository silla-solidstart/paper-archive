/**
 * Admin cost dashboard — local only, no deploy.
 *
 * Reads the scan_costs ledger straight from Neon and serves a single page on
 * localhost. DATABASE_URL comes from the environment or from Secret Manager
 * via gcloud, never printed. Binds to 127.0.0.1 only.
 *
 *   node scripts/dashboard.ts          # http://localhost:8799
 *   PORT=9000 node scripts/dashboard.ts
 */
import { neon } from "@neondatabase/serverless";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JPY_PER_USD, PRICING_AS_OF } from "../src/pricing.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8799);
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
    console.error("DATABASE_URL is not set and could not be read from Secret Manager (gcloud auth login?).");
    process.exit(2);
  }
}

const sql = neon(databaseUrl());

async function data(days: number | null) {
  // One WHERE clause for every query so all charts describe the same slice.
  const where = days ? `WHERE c.created_at >= now() - ($1 || ' days')::interval` : "";
  const params = days ? [String(days)] : [];
  const q = (text: string) => sql.query(text.replace(/\{W\}/g, where), params) as Promise<Record<string, unknown>[]>;

  const [totals] = await q(`
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE status = 'complete')::int AS completed,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           coalesce(sum(total_usd), 0)::float AS total_usd,
           coalesce(sum(ocr_usd), 0)::float AS ocr_usd,
           coalesce(sum(llm_usd), 0)::float AS llm_usd,
           coalesce(avg(total_usd) FILTER (WHERE status = 'complete'), 0)::float AS avg_usd,
           coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_usd) FILTER (WHERE status = 'complete'), 0)::float AS p50_usd,
           coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_usd) FILTER (WHERE status = 'complete'), 0)::float AS p95_usd,
           coalesce(avg(input_tokens + output_tokens) FILTER (WHERE status = 'complete'), 0)::float AS avg_tokens,
           coalesce(avg(duration_ms) FILTER (WHERE status = 'complete'), 0)::float AS avg_duration_ms,
           count(DISTINCT user_id)::int AS users, count(DISTINCT space_id)::int AS spaces,
           min(created_at) AS since
    FROM scan_costs c {W}`);

  const daily = await q(`
    SELECT to_char(date_trunc('day', c.created_at), 'YYYY-MM-DD') AS day,
           coalesce(sum(ocr_usd), 0)::float AS ocr_usd, coalesce(sum(llm_usd), 0)::float AS llm_usd,
           count(*)::int AS attempts, count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM scan_costs c {W} GROUP BY 1 ORDER BY 1`);

  const perScan = await q(`
    SELECT total_usd::float AS usd, mime_type, ocr_pages, input_tokens, output_tokens
    FROM scan_costs c {W} ${where ? "AND" : "WHERE"} status = 'complete' ORDER BY created_at DESC LIMIT 5000`);

  const byModel = await q(`
    SELECT coalesce(model, '(failed before model)') AS model, count(*)::int AS scans,
           coalesce(avg(total_usd), 0)::float AS avg_usd, coalesce(sum(total_usd), 0)::float AS total_usd
    FROM scan_costs c {W} GROUP BY 1 ORDER BY 4 DESC`);

  const bySpace = await q(`
    SELECT coalesce(s.name, '(no space)') AS space, count(*)::int AS scans,
           coalesce(sum(c.total_usd), 0)::float AS total_usd, coalesce(avg(c.total_usd), 0)::float AS avg_usd
    FROM scan_costs c LEFT JOIN spaces s ON s.id = c.space_id {W} GROUP BY 1 ORDER BY 3 DESC LIMIT 12`);

  const byUser = await q(`
    SELECT coalesce(u.name, u.email, '(deleted user)') AS "user", count(*)::int AS scans,
           coalesce(sum(c.total_usd), 0)::float AS total_usd
    FROM scan_costs c LEFT JOIN users u ON u.id = c.user_id {W} GROUP BY 1 ORDER BY 3 DESC LIMIT 12`);

  const recent = await q(`
    SELECT to_char(c.created_at, 'MM-DD HH24:MI') AS at, c.status, c.stage, c.mime_type, c.ocr_pages,
           c.input_tokens, c.output_tokens, c.total_usd::float AS usd, c.duration_ms, s.name AS space
    FROM scan_costs c LEFT JOIN spaces s ON s.id = c.space_id {W} ORDER BY c.created_at DESC LIMIT 50`);

  return { generated_at: new Date().toISOString(), days, jpy_per_usd: JPY_PER_USD, pricing_as_of: PRICING_AS_OF,
           totals, daily, per_scan: perScan, by_model: byModel, by_space: bySpace, by_user: byUser, recent };
}

const page = readFileSync(path.join(here, "..", "admin", "dashboard.html"));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/data") {
      const d = url.searchParams.get("days");
      const days = d === "all" || d === null ? null : Math.max(1, Math.min(3650, Number(d) || 30));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(await data(days)));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cost dashboard: http://localhost:${PORT}  (local only; Ctrl-C to stop)`);
});

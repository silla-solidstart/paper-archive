import { neon } from "@neondatabase/serverless";
import type { Env } from "./types.ts";
import type { Extraction, Lang, RetentionStatus } from "./extract.ts";
import type { Cost } from "./pricing.ts";
import type { OcrResult } from "./docai.ts";

/**
 * Postgres is the filing system. Drive folders are for humans.
 *
 * Search is trigram/ILIKE, not full-text: Postgres FTS cannot segment Japanese.
 * See migrations/0001_init.sql.
 */

export interface DocumentRow {
  id: string;
  user_id: string;
  drive_file_id: string | null;
  filename: string | null;
  ocr_text: string | null;
  ocr_provider: string | null;
  ocr_confidence: number | null;
  title: string | null;
  document_type: string | null;
  issuer: string | null;
  document_date: string | null;
  summary: string | null;
  action_required: boolean;
  action_type: string | null;
  action_date: string | null;
  retention: string;
  retention_reason: string | null;
  extracted_data: Record<string, unknown>;
  extraction_model: string | null;
  lang: string | null;
  cost_usd: string | number | null;
  ocr_pages: number | null;
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string | null;
  drive_folder_id: string | null;
  google_refresh_token_enc: string | null;
  google_access_token: string | null;
  google_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function sql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return neon(env.DATABASE_URL);
}

/** LIKE metacharacters in user input mean themselves: "100%" is the string 100%. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => "\\" + m);
}

export async function pingDatabase(env: Env): Promise<boolean> {
  try {
    await sql(env).query("SELECT 1", []);
    return true;
  } catch {
    return false;
  }
}

export function hasDatabase(env: Env): boolean {
  return Boolean(env.DATABASE_URL);
}

/**
 * Until Google sign-in exists there is exactly one user: whoever holds the
 * bearer token. Represent that honestly as a row rather than relaxing the
 * NOT NULL on documents.user_id.
 */
export async function ensureLocalUser(env: Env): Promise<string> {
  const q = sql(env);
  const rows = await q.query(
    `INSERT INTO users (google_sub, email, name)
     VALUES ('local', 'local@paper-archive.invalid', 'Local user')
     ON CONFLICT (google_sub) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [],
  );
  return (rows as Array<{ id: string }>)[0].id;
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  const rows = await sql(env).query(`SELECT * FROM users WHERE id = $1`, [id]);
  return (rows as UserRow[])[0] ?? null;
}

export async function upsertGoogleUser(
  env: Env,
  u: { sub: string; email: string; name: string | null; refreshTokenEnc: string; accessToken: string; expiresAt: Date },
): Promise<UserRow> {
  const rows = await sql(env).query(
    `INSERT INTO users (google_sub, email, name, google_refresh_token_enc, google_access_token, google_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email,
       name = COALESCE(EXCLUDED.name, users.name),
       google_refresh_token_enc = EXCLUDED.google_refresh_token_enc,
       google_access_token = EXCLUDED.google_access_token,
       google_token_expires_at = EXCLUDED.google_token_expires_at
     RETURNING *`,
    [u.sub, u.email, u.name, u.refreshTokenEnc, u.accessToken, u.expiresAt.toISOString()],
  );
  return (rows as UserRow[])[0];
}

export async function updateUserTokens(env: Env, id: string, accessToken: string, expiresAt: Date): Promise<void> {
  await sql(env).query(
    `UPDATE users SET google_access_token = $2, google_token_expires_at = $3 WHERE id = $1`,
    [id, accessToken, expiresAt.toISOString()],
  );
}

export async function updateUserDriveFolder(env: Env, id: string, folderId: string): Promise<void> {
  await sql(env).query(`UPDATE users SET drive_folder_id = $2 WHERE id = $1`, [id, folderId]);
}

export async function updateDocumentFiling(
  env: Env,
  id: string,
  f: { driveFileId: string | null; filename: string | null; status: "complete" | "failed"; error: string | null },
): Promise<void> {
  await sql(env).query(
    `UPDATE documents SET drive_file_id = $2, filename = COALESCE($3, filename), status = $4, error = $5 WHERE id = $1`,
    [id, f.driveFileId, f.filename, f.status, f.error],
  );
}

/** The human's decision overrides the model's. Returns false if not found. */
export async function updateDocumentRetention(
  env: Env,
  userId: string,
  id: string,
  retention: RetentionStatus,
  reason: string,
): Promise<boolean> {
  const rows = await sql(env).query(
    `UPDATE documents SET retention = $3::retention_status, retention_reason = $4
     WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, id, retention, reason],
  );
  return (rows as unknown[]).length > 0;
}

export async function insertDocument(
  env: Env,
  userId: string,
  filename: string | null,
  ocr: OcrResult,
  x: Extraction,
  model: string,
  status: "complete" | "filing" = "complete",
  meta: { lang: Lang; cost: Cost; inputTokens: number; outputTokens: number } | null = null,
): Promise<string> {
  const q = sql(env);

  // Promote the cross-type fields to columns; everything else rides in JSONB.
  const extracted: Record<string, unknown> = {
    amount: x.amount,
    currency: x.currency,
    due_date: x.due_date,
    reference_number: x.reference_number,
    categories: x.categories,
  };
  for (const { key, value } of x.other_fields) extracted[key] = value;

  const rows = await q.query(
    `INSERT INTO documents (
       user_id, filename,
       ocr_text, ocr_provider, ocr_confidence,
       title, document_type, issuer, document_date, summary,
       action_required, action_type, action_date,
       retention, retention_reason,
       extracted_data, extraction_model, status,
       lang, cost_usd, ocr_pages, llm_input_tokens, llm_output_tokens
     ) VALUES (
       $1, $2,
       $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13,
       $14, $15,
       $16, $17, $18,
       $19, $20, $21, $22, $23
     ) RETURNING id`,
    [
      userId, filename,
      ocr.text, ocr.provider, ocr.confidence,
      x.title, x.document_type, x.issuer, x.document_date, x.summary,
      x.action_required, x.action_type, x.action_date,
      x.retention, x.retention_reason,
      JSON.stringify(extracted), model, status,
      meta?.lang ?? null, meta?.cost.total_usd ?? null, ocr.pageCount,
      meta?.inputTokens ?? null, meta?.outputTokens ?? null,
    ],
  );
  return (rows as Array<{ id: string }>)[0].id;
}

const LIST_COLUMNS = `id, title, document_type, issuer, document_date, summary,
  action_required, action_type, action_date, retention, lang, cost_usd, created_at`;

export async function searchDocuments(
  env: Env,
  userId: string,
  query: string,
  limit = 20,
): Promise<Partial<DocumentRow>[]> {
  const q = sql(env);
  // ILIKE with a leading wildcard is served by the trigram GIN indexes and
  // works on Japanese, which tsvector does not. Escape the LIKE metacharacters
  // so a search for "100%" means the string "100%".
  const pattern = "%" + escapeLike(query) + "%";
  const rows = await q.query(
    `SELECT ${LIST_COLUMNS}
     FROM documents
     WHERE user_id = $1
       AND (ocr_text ILIKE $2 OR title ILIKE $2 OR issuer ILIKE $2 OR summary ILIKE $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, pattern, limit],
  );
  return rows as Partial<DocumentRow>[];
}

export async function getDocument(
  env: Env,
  userId: string,
  id: string,
): Promise<DocumentRow | null> {
  const q = sql(env);
  const rows = await q.query(
    `SELECT * FROM documents WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  return (rows as DocumentRow[])[0] ?? null;
}

/** Removes the index row. Returns the Drive file id so the caller can trash it. */
export async function deleteDocument(env: Env, userId: string, id: string): Promise<{ drive_file_id: string | null } | null> {
  const rows = await sql(env).query(
    `DELETE FROM documents WHERE user_id = $1 AND id = $2 RETURNING drive_file_id`,
    [userId, id],
  );
  return (rows as Array<{ drive_file_id: string | null }>)[0] ?? null;
}

export async function listActions(
  env: Env,
  userId: string,
  limit = 50,
): Promise<Partial<DocumentRow>[]> {
  const q = sql(env);
  const rows = await q.query(
    `SELECT ${LIST_COLUMNS}
     FROM documents
     WHERE user_id = $1 AND action_required
     ORDER BY action_date ASC NULLS LAST, created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows as Partial<DocumentRow>[];
}

export interface ScanCostRow {
  userId: string | null;
  documentId: string | null;
  status: "complete" | "failed";
  stage: string | null;
  lang: string | null;
  mimeType: string;
  bytes: number;
  ocrPages: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  ocrUsd: number;
  llmUsd: number;
  totalUsd: number;
  pricingAsOf: string | null;
  durationMs: number;
}

/** The ledger row. Written for every attempt; never deleted. */
export async function recordScanCost(env: Env, r: ScanCostRow): Promise<void> {
  await sql(env).query(
    `INSERT INTO scan_costs (
       user_id, document_id, status, stage, lang, mime_type, bytes,
       ocr_pages, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       ocr_usd, llm_usd, total_usd, pricing_as_of, duration_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      r.userId, r.documentId, r.status, r.stage, r.lang, r.mimeType, r.bytes,
      r.ocrPages, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens,
      r.ocrUsd, r.llmUsd, r.totalUsd, r.pricingAsOf, r.durationMs,
    ],
  );
}

/**
 * Unit economics. userId null = platform-wide (operator view).
 * Averages and percentiles are over completed scans; totals include failures,
 * because failed attempts cost money too.
 */
export async function costSummary(env: Env, userId: string | null): Promise<Record<string, unknown>> {
  const q = sql(env);
  const where = userId ? "WHERE user_id = $1" : "";
  const params = userId ? [userId] : [];
  const [totals] = (await q.query(
    `SELECT
       count(*)::int                                                AS attempts,
       count(*) FILTER (WHERE status = 'complete')::int             AS completed,
       coalesce(sum(total_usd), 0)::float                           AS total_usd,
       coalesce(sum(ocr_usd), 0)::float                             AS ocr_usd,
       coalesce(sum(llm_usd), 0)::float                             AS llm_usd,
       coalesce(avg(total_usd) FILTER (WHERE status = 'complete'), 0)::float AS avg_usd_per_scan,
       coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_usd) FILTER (WHERE status = 'complete'), 0)::float AS p50_usd,
       coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_usd) FILTER (WHERE status = 'complete'), 0)::float AS p95_usd,
       coalesce(avg(input_tokens + output_tokens) FILTER (WHERE status = 'complete'), 0)::float AS avg_tokens,
       coalesce(avg(ocr_pages) FILTER (WHERE status = 'complete'), 0)::float AS avg_pages,
       coalesce(avg(duration_ms) FILTER (WHERE status = 'complete'), 0)::float AS avg_duration_ms,
       min(created_at)                                              AS since,
       count(DISTINCT user_id)::int                                 AS users
     FROM scan_costs ${where}`,
    params,
  )) as Record<string, unknown>[];
  const byMonth = (await q.query(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
            count(*)::int AS attempts, coalesce(sum(total_usd), 0)::float AS total_usd
     FROM scan_costs ${where} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    params,
  )) as Record<string, unknown>[];
  const byModel = (await q.query(
    `SELECT model, count(*)::int AS scans, coalesce(avg(total_usd), 0)::float AS avg_usd
     FROM scan_costs ${where ? where + " AND" : "WHERE"} status = 'complete' GROUP BY 1 ORDER BY 2 DESC`,
    params,
  )) as Record<string, unknown>[];
  return { ...totals, by_month: byMonth, by_model: byModel };
}

export async function listRecent(
  env: Env,
  userId: string,
  limit = 50,
): Promise<Partial<DocumentRow>[]> {
  const q = sql(env);
  const rows = await q.query(
    `SELECT ${LIST_COLUMNS}, status
     FROM documents
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows as Partial<DocumentRow>[];
}

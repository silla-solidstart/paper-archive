import { neon } from "@neondatabase/serverless";
import type { Env } from "./types.ts";
import { EXTRACTION_VERSION, type Extraction, type Lang, type RetentionStatus } from "./extract.ts";
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
  space_id: string;
  user_id: string; // scanned by
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
  // v2 (migration 0006)
  source_lang: string | null;
  handling: string[];
  issuer_key: string | null;
  keywords: string[];
  extraction_version: number;
  extracted_at: string | null;
  user_overrides: Record<string, boolean>;
  mime_type: string | null;
  bytes: number | null;
  storage_key: string | null; // R2 object key (migration 0007)
}

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string | null;
  drive_folder_id: string | null; // unused since 0007
  google_refresh_token_enc: string | null; // unused since 0007 (Drive scope dropped); nullable
  google_access_token: string | null;
  google_token_expires_at: string | null;
  current_space_id: string | null;
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
  u: { sub: string; email: string; name: string | null; refreshTokenEnc: string | null; accessToken: string; expiresAt: Date },
): Promise<UserRow> {
  const rows = await sql(env).query(
    `INSERT INTO users (google_sub, email, name, google_refresh_token_enc, google_access_token, google_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (google_sub) DO UPDATE SET
       email = EXCLUDED.email,
       name = COALESCE(EXCLUDED.name, users.name),
       google_refresh_token_enc = COALESCE(EXCLUDED.google_refresh_token_enc, users.google_refresh_token_enc),
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

export async function updateDocumentFiling(
  env: Env,
  id: string,
  f: { filename: string | null; status: "complete" | "failed"; error: string | null },
): Promise<void> {
  await sql(env).query(
    `UPDATE documents SET filename = COALESCE($2, filename), status = $3, error = $4 WHERE id = $1`,
    [id, f.filename, f.status, f.error],
  );
}

/** The human's decision overrides the model's. Returns false if not found. */
export async function updateDocumentRetention(
  env: Env,
  spaceId: string,
  id: string,
  retention: RetentionStatus,
  reason: string,
): Promise<boolean> {
  const rows = await sql(env).query(
    `UPDATE documents SET retention = $3::retention_status, retention_reason = $4,
            user_overrides = user_overrides || '{"retention": true}'::jsonb
     WHERE space_id = $1 AND id = $2 RETURNING id`,
    [spaceId, id, retention, reason],
  );
  return (rows as unknown[]).length > 0;
}

/** The human names the sender (the paper did not say, or the model got it wrong). Sticks across re-analysis. */
export async function updateDocumentIssuer(env: Env, spaceId: string, id: string, issuer: string): Promise<DocumentRow | null> {
  const rows = await sql(env).query(
    `UPDATE documents SET issuer = $3, issuer_key = $3, user_overrides = user_overrides || '{"issuer": true}'::jsonb
     WHERE space_id = $1 AND id = $2 RETURNING *`,
    [spaceId, id, issuer],
  );
  return (rows as DocumentRow[])[0] ?? null;
}

export async function insertDocument(
  env: Env,
  spaceId: string,
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
  if (x.tables?.length) extracted.tables = x.tables;

  const rows = await q.query(
    `INSERT INTO documents (
       space_id, user_id, filename,
       ocr_text, ocr_provider, ocr_confidence,
       title, document_type, issuer, document_date, summary,
       action_required, action_type, action_date,
       retention, retention_reason,
       extracted_data, extraction_model, status,
       lang, cost_usd, ocr_pages, llm_input_tokens, llm_output_tokens,
       source_lang, handling, issuer_key, keywords, extraction_version, extracted_at
     ) VALUES (
       $24, $1, $2,
       $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13,
       $14, $15,
       $16, $17, $18,
       $19, $20, $21, $22, $23,
       $25, $26, $27, $28, $29, now()
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
      spaceId,
      x.source_lang, x.handling, x.issuer_key, x.keywords, EXTRACTION_VERSION,
    ],
  );
  const id = (rows as Array<{ id: string }>)[0].id;
  await recordExtraction(env, id, x, model, meta?.lang ?? null, "ingest", true, meta);
  await upsertExpense(env, id, spaceId, x);
  return id;
}

/**
 * Store-first ingest: the row is created, the bytes are put under a key
 * derived from its id, then OCR runs. Everything interpretive is filled in
 * by applyExtraction.
 */
export async function insertStagedDocument(
  env: Env,
  spaceId: string,
  userId: string,
  f: { filename: string; mimeType: string; bytes: number; lang: Lang },
): Promise<string> {
  const rows = await sql(env).query(
    `INSERT INTO documents (space_id, user_id, filename, mime_type, bytes, lang, status, title)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $3) RETURNING id`,
    [spaceId, userId, f.filename, f.mimeType, f.bytes, f.lang],
  );
  return (rows as Array<{ id: string }>)[0].id;
}

export async function setDocumentStatus(env: Env, id: string, status: "ocr" | "extracting"): Promise<void> {
  await sql(env).query(`UPDATE documents SET status = $2 WHERE id = $1`, [id, status]);
}

/** Stored but not (fully) read: never started, or cut off mid-way more than a couple of minutes ago. */
export async function listUnprocessed(env: Env, limit = 3): Promise<Array<{ id: string }>> {
  return (await sql(env).query(
    `SELECT id FROM documents
     WHERE storage_key IS NOT NULL AND status IN ('pending', 'ocr', 'extracting')
       AND updated_at < now() - interval '2 minutes'
     ORDER BY created_at LIMIT $1`, [limit],
  )) as Array<{ id: string }>;
}

export async function setDocumentStorage(env: Env, id: string, storageKey: string): Promise<void> {
  await sql(env).query(`UPDATE documents SET storage_key = $2 WHERE id = $1`, [id, storageKey]);
}

/** A staged row whose bytes never made it to storage: nothing to keep. */
export async function discardDocument(env: Env, id: string): Promise<void> {
  await sql(env).query(`DELETE FROM documents WHERE id = $1 AND status = 'pending'`, [id]);
}

export async function setDocumentOcr(env: Env, id: string, ocr: OcrResult): Promise<void> {
  await sql(env).query(
    `UPDATE documents SET ocr_text = $2, ocr_provider = $3, ocr_confidence = $4, ocr_pages = $5 WHERE id = $1`,
    [id, ocr.text, ocr.provider, ocr.confidence, ocr.pageCount],
  );
}

export async function markDocumentFailed(env: Env, id: string, error: string): Promise<void> {
  await sql(env).query(`UPDATE documents SET status = 'failed', error = $2 WHERE id = $1`, [id, error.slice(0, 500)]);
}

export interface ExtractionMeta { lang: Lang; cost: Cost; inputTokens: number; outputTokens: number }

/**
 * Writes an extraction onto a document — at ingest or on re-analysis. Fields
 * the human has set (user_overrides) are left alone; the model's answer for
 * them still lands in the history row, so nothing is lost.
 */
export async function applyExtraction(
  env: Env,
  id: string,
  spaceId: string,
  x: Extraction,
  model: string,
  meta: ExtractionMeta,
  trigger: "ingest" | "reanalyze",
  withImage: boolean,
  status: "complete" | "failed" = "complete",
): Promise<void> {
  const q = sql(env);
  const extracted: Record<string, unknown> = {
    amount: x.amount, currency: x.currency, due_date: x.due_date,
    reference_number: x.reference_number, categories: x.categories,
  };
  for (const { key, value } of x.other_fields) extracted[key] = value;
  if (x.tables?.length) extracted.tables = x.tables;

  await q.query(
    `UPDATE documents SET
       title = $2, document_type = $3, document_date = $5, summary = $6,
       issuer = CASE WHEN coalesce((user_overrides->>'issuer')::boolean, false) THEN issuer ELSE $4 END,
       action_required = $7, action_type = $8, action_date = $9,
       retention = CASE WHEN coalesce((user_overrides->>'retention')::boolean, false) THEN retention ELSE $10::retention_status END,
       retention_reason = CASE WHEN coalesce((user_overrides->>'retention')::boolean, false) THEN retention_reason ELSE $11 END,
       extracted_data = $12, extraction_model = $13, status = $14, error = NULL,
       lang = $15, cost_usd = coalesce(cost_usd, 0) + $16, llm_input_tokens = $17, llm_output_tokens = $18,
       source_lang = $19, handling = $20, keywords = $22,
       issuer_key = CASE WHEN coalesce((user_overrides->>'issuer')::boolean, false) THEN issuer_key ELSE $21 END,
       extraction_version = $23, extracted_at = now()
     WHERE id = $1`,
    [
      id, x.title, x.document_type, x.issuer, x.document_date, x.summary,
      x.action_required, x.action_type, x.action_date, x.retention, x.retention_reason,
      JSON.stringify(extracted), model, status,
      meta.lang, meta.cost.total_usd, meta.inputTokens, meta.outputTokens,
      x.source_lang, x.handling, x.issuer_key, x.keywords, EXTRACTION_VERSION,
    ],
  );
  await recordExtraction(env, id, x, model, meta.lang, trigger, withImage, meta);
  await upsertExpense(env, id, spaceId, x);
}

async function recordExtraction(
  env: Env, id: string, x: Extraction, model: string, lang: string | null,
  trigger: "ingest" | "reanalyze", withImage: boolean, meta: ExtractionMeta | null,
): Promise<void> {
  await sql(env).query(
    `INSERT INTO document_extractions (document_id, version, model, lang, trigger, with_image, data, cost_usd, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, EXTRACTION_VERSION, model, lang, trigger, withImage, JSON.stringify(x),
     meta?.cost.llm_usd ?? null, meta?.inputTokens ?? null, meta?.outputTokens ?? null],
  );
}

/** The expense ledger for one document: replaced wholesale on every extraction. */
async function upsertExpense(env: Env, id: string, spaceId: string, x: Extraction): Promise<void> {
  const q = sql(env);
  const e = x.handling.includes("expense") ? x.expense : null;
  if (!e) { await q.query(`DELETE FROM expenses WHERE document_id = $1`, [id]); return; }
  await q.query(
    `INSERT INTO expenses (document_id, space_id, merchant, merchant_key, spent_on, total, tax, currency, payment_method, expense_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (document_id) DO UPDATE SET
       merchant = EXCLUDED.merchant, merchant_key = EXCLUDED.merchant_key, spent_on = EXCLUDED.spent_on,
       total = EXCLUDED.total, tax = EXCLUDED.tax, currency = EXCLUDED.currency,
       payment_method = EXCLUDED.payment_method, expense_kind = EXCLUDED.expense_kind`,
    [id, spaceId, e.merchant, e.merchant_key ?? x.issuer_key, e.spent_on ?? x.document_date, e.total ?? x.amount,
     e.tax, e.currency || "JPY", e.payment_method, e.expense_kind],
  );
  await q.query(`DELETE FROM expense_items WHERE document_id = $1`, [id]);
  let position = 0;
  for (const it of e.items.slice(0, 200)) {
    await q.query(
      `INSERT INTO expense_items (document_id, space_id, position, name, quantity, unit_price, amount, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, spaceId, position++, it.name.slice(0, 200), it.quantity, it.unit_price, it.amount, it.category],
    );
  }
}

export interface ExpenseRow {
  document_id: string; merchant: string | null; merchant_key: string | null; spent_on: string | null;
  total: string | number | null; tax: string | number | null; currency: string; payment_method: string | null; expense_kind: string;
  items: Array<{ position: number; name: string; quantity: number | null; unit_price: number | null; amount: number | null; category: string }>;
}

export async function getExpense(env: Env, id: string): Promise<ExpenseRow | null> {
  const q = sql(env);
  const [e] = (await q.query(`SELECT * FROM expenses WHERE document_id = $1`, [id])) as ExpenseRow[];
  if (!e) return null;
  const items = (await q.query(
    `SELECT position, name, quantity::float, unit_price::float, amount::float, category
     FROM expense_items WHERE document_id = $1 ORDER BY position`, [id],
  )) as ExpenseRow["items"];
  return { ...e, items };
}

/** Senders this archive has seen, most frequent first — the "who is it from?" chips. */
export async function listIssuers(env: Env, spaceId: string, limit = 12): Promise<Array<{ issuer_key: string; count: number }>> {
  return (await sql(env).query(
    `SELECT issuer_key, count(*)::int AS count FROM documents
     WHERE space_id = $1 AND issuer_key IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC, max(created_at) DESC LIMIT $2`,
    [spaceId, limit],
  )) as Array<{ issuer_key: string; count: number }>;
}

/** Documents produced by an older schema/prompt than the current one. */
export async function listStale(env: Env, spaceId: string | null, limit = 50): Promise<Array<{ id: string; space_id: string; extraction_version: number }>> {
  const where = spaceId ? "AND space_id = $3" : "";
  const params: unknown[] = [EXTRACTION_VERSION, limit];
  if (spaceId) params.push(spaceId);
  return (await sql(env).query(
    `SELECT id, space_id, extraction_version FROM documents
     WHERE extraction_version < $1 AND status IN ('complete', 'failed') ${where}
     ORDER BY created_at DESC LIMIT $2`, params,
  )) as Array<{ id: string; space_id: string; extraction_version: number }>;
}

/** A month of spending: totals, by category (line items), by merchant, and the receipts. */
export async function spendingSummary(env: Env, spaceId: string, month: string): Promise<Record<string, unknown>> {
  const q = sql(env);
  const [totals] = (await q.query(
    `SELECT coalesce(sum(total), 0)::float AS total, count(*)::int AS expenses, coalesce(sum(tax), 0)::float AS tax
     FROM expenses WHERE space_id = $1 AND to_char(spent_on, 'YYYY-MM') = $2`, [spaceId, month],
  )) as Record<string, unknown>[];
  const byKind = await q.query(
    `SELECT expense_kind AS kind, coalesce(sum(total), 0)::float AS amount, count(*)::int AS expenses
     FROM expenses WHERE space_id = $1 AND to_char(spent_on, 'YYYY-MM') = $2 GROUP BY 1 ORDER BY 2 DESC`, [spaceId, month]);
  const byCategory = await q.query(
    `SELECT i.category, coalesce(sum(i.amount), 0)::float AS amount, count(*)::int AS items
     FROM expense_items i JOIN expenses e ON e.document_id = i.document_id
     WHERE e.space_id = $1 AND to_char(e.spent_on, 'YYYY-MM') = $2 GROUP BY 1 ORDER BY 2 DESC`, [spaceId, month]);
  const byMerchant = await q.query(
    `SELECT coalesce(merchant_key, merchant, '?') AS merchant, coalesce(sum(total), 0)::float AS amount, count(*)::int AS expenses
     FROM expenses WHERE space_id = $1 AND to_char(spent_on, 'YYYY-MM') = $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 20`, [spaceId, month]);
  const list = await q.query(
    `SELECT e.document_id AS id, d.title, coalesce(e.merchant_key, e.merchant) AS merchant, e.spent_on, e.total::float, e.currency, e.expense_kind,
            (SELECT count(*)::int FROM expense_items i WHERE i.document_id = e.document_id) AS items
     FROM expenses e JOIN documents d ON d.id = e.document_id
     WHERE e.space_id = $1 AND to_char(e.spent_on, 'YYYY-MM') = $2 ORDER BY e.spent_on DESC, d.created_at DESC`, [spaceId, month]);
  const months = await q.query(
    `SELECT to_char(spent_on, 'YYYY-MM') AS month, coalesce(sum(total), 0)::float AS total
     FROM expenses WHERE space_id = $1 AND spent_on IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 24`, [spaceId]);
  return { month, ...totals, by_kind: byKind, by_category: byCategory, by_merchant: byMerchant, expenses: list, months };
}

/** Line items, filterable: "snacks in August" is exactly this query. */
export async function listExpenseItems(
  env: Env, spaceId: string, f: { month?: string; category?: string; query?: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  const conds = ["e.space_id = $1"]; const params: unknown[] = [spaceId];
  if (f.month) { params.push(f.month); conds.push(`to_char(e.spent_on, 'YYYY-MM') = $${params.length}`); }
  if (f.category) { params.push(f.category); conds.push(`i.category = $${params.length}`); }
  if (f.query) { params.push("%" + escapeLike(f.query) + "%"); conds.push(`i.name ILIKE $${params.length}`); }
  params.push(Math.min(500, f.limit ?? 200));
  return (await sql(env).query(
    `SELECT i.name, i.quantity::float, i.unit_price::float, i.amount::float, i.category,
            e.spent_on, coalesce(e.merchant_key, e.merchant) AS merchant, e.currency, e.document_id
     FROM expense_items i JOIN expenses e ON e.document_id = i.document_id
     WHERE ${conds.join(" AND ")} ORDER BY e.spent_on DESC, i.position LIMIT $${params.length}`, params,
  )) as Array<Record<string, unknown>>;
}

const LIST_COLUMNS = `id, user_id, title, document_type, issuer, document_date, summary,
  action_required, action_type, action_date, retention, lang, cost_usd, created_at, handling, status`;

export async function searchDocuments(
  env: Env,
  spaceId: string,
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
     WHERE space_id = $1
       AND (ocr_text ILIKE $2 OR title ILIKE $2 OR issuer ILIKE $2 OR summary ILIKE $2
            OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE $2))
     ORDER BY created_at DESC
     LIMIT $3`,
    [spaceId, pattern, limit],
  );
  return rows as Partial<DocumentRow>[];
}

export async function getDocument(
  env: Env,
  spaceId: string | null, // null = any space (admin/operator only)
  id: string,
): Promise<DocumentRow | null> {
  const q = sql(env);
  const rows = spaceId
    ? await q.query(`SELECT * FROM documents WHERE space_id = $1 AND id = $2`, [spaceId, id])
    : await q.query(`SELECT * FROM documents WHERE id = $1`, [id]);
  return (rows as DocumentRow[])[0] ?? null;
}

/** Removes the index row. Returns the storage key so the caller can delete the object. */
export async function deleteDocument(env: Env, spaceId: string, id: string): Promise<{ storage_key: string | null } | null> {
  const rows = await sql(env).query(
    `DELETE FROM documents WHERE space_id = $1 AND id = $2 RETURNING storage_key`,
    [spaceId, id],
  );
  return (rows as Array<{ storage_key: string | null }>)[0] ?? null;
}

export async function listActions(
  env: Env,
  spaceId: string,
  limit = 50,
): Promise<Partial<DocumentRow>[]> {
  const q = sql(env);
  const rows = await q.query(
    `SELECT ${LIST_COLUMNS}
     FROM documents
     WHERE space_id = $1 AND action_required
     ORDER BY action_date ASC NULLS LAST, created_at DESC
     LIMIT $2`,
    [spaceId, limit],
  );
  return rows as Partial<DocumentRow>[];
}

export interface ScanCostRow {
  userId: string | null;
  spaceId: string | null;
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
  kind?: "ingest" | "reanalyze";
}

/** The ledger row. Written for every attempt; never deleted. */
export async function recordScanCost(env: Env, r: ScanCostRow): Promise<void> {
  await sql(env).query(
    `INSERT INTO scan_costs (
       user_id, document_id, status, stage, lang, mime_type, bytes,
       ocr_pages, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       ocr_usd, llm_usd, total_usd, pricing_as_of, duration_ms, space_id, kind
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      r.userId, r.documentId, r.status, r.stage, r.lang, r.mimeType, r.bytes,
      r.ocrPages, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens,
      r.ocrUsd, r.llmUsd, r.totalUsd, r.pricingAsOf, r.durationMs, r.spaceId, r.kind ?? "ingest",
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
  const bySpace = (await q.query(
    `SELECT s.name AS space, count(*)::int AS attempts, coalesce(sum(c.total_usd), 0)::float AS total_usd
     FROM scan_costs c LEFT JOIN spaces s ON s.id = c.space_id ${where.replace("user_id", "c.user_id")}
     GROUP BY 1 ORDER BY 3 DESC LIMIT 20`,
    params,
  )) as Record<string, unknown>[];
  const byKind = (await q.query(
    `SELECT kind, count(*)::int AS attempts, coalesce(sum(total_usd), 0)::float AS total_usd
     FROM scan_costs ${where} GROUP BY 1 ORDER BY 3 DESC`,
    params,
  )) as Record<string, unknown>[];
  // Per user: who is costing what. Deleted users show as "(deleted)"; the
  // rows survive by design (see migration 0003).
  const byUser = (await q.query(
    `SELECT coalesce(u.email, '(deleted)') AS email, u.name,
            count(*)::int AS attempts,
            count(*) FILTER (WHERE c.kind = 'reanalyze')::int AS reanalyses,
            coalesce(sum(c.total_usd), 0)::float AS total_usd,
            coalesce(sum(c.total_usd) FILTER (WHERE date_trunc('month', c.created_at) = date_trunc('month', now())), 0)::float AS month_usd,
            max(c.created_at) AS last_at
     FROM scan_costs c LEFT JOIN users u ON u.id = c.user_id ${where.replace("user_id", "c.user_id")}
     GROUP BY 1, 2 ORDER BY 5 DESC LIMIT 50`,
    params,
  )) as Record<string, unknown>[];
  return { ...totals, by_month: byMonth, by_model: byModel, by_space: bySpace, by_kind: byKind, by_user: byUser };
}

export async function listRecent(
  env: Env,
  spaceId: string,
  limit = 50,
): Promise<Partial<DocumentRow>[]> {
  const q = sql(env);
  const rows = await q.query(
    `SELECT ${LIST_COLUMNS}, status
     FROM documents
     WHERE space_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [spaceId, limit],
  );
  return rows as Partial<DocumentRow>[];
}

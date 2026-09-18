import { neon } from "@neondatabase/serverless";
import type { Env } from "./types";
import type { Extraction } from "./extract";
import type { OcrResult } from "./docai";

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
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function sql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return neon(env.DATABASE_URL);
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

export async function insertDocument(
  env: Env,
  userId: string,
  filename: string | null,
  ocr: OcrResult,
  x: Extraction,
  model: string,
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
       extracted_data, extraction_model, status
     ) VALUES (
       $1, $2,
       $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13,
       $14, $15,
       $16, $17, 'complete'
     ) RETURNING id`,
    [
      userId, filename,
      ocr.text, ocr.provider, ocr.confidence,
      x.title, x.document_type, x.issuer, x.document_date, x.summary,
      x.action_required, x.action_type, x.action_date,
      x.retention, x.retention_reason,
      JSON.stringify(extracted), model,
    ],
  );
  return (rows as Array<{ id: string }>)[0].id;
}

const LIST_COLUMNS = `id, title, document_type, issuer, document_date, summary,
  action_required, action_type, action_date, retention, created_at`;

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
  const pattern = "%" + query.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
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

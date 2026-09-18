-- 0001_init — users and documents
--
-- Design notes:
--  * ocr_text (what Document AI saw) and the extracted fields (what the LLM
--    concluded) are stored separately and neither is derived from the other.
--    The model output is never the only representation of a document.
--  * extracted_data JSONB holds document-type-specific fields, because a tax
--    notice, a utility bill and a school letter have genuinely different shapes.
--    Promote a field to a real column only once it is queried across all types.
--  * No tsvector column. Postgres FTS does not segment Japanese — 固定資産税納税通知書
--    tokenises as one meaningless term. Trigram indexes below are the MVP answer.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE retention_status AS ENUM (
  'digital_sufficient',   -- digital copy likely sufficient
  'keep_temporarily',
  'keep_original',
  'unsure'                -- user review required — the conservative default
);

CREATE TYPE processing_status AS ENUM (
  'pending', 'ocr', 'extracting', 'filing', 'complete', 'failed'
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub      text NOT NULL UNIQUE,      -- stable Google account id, not email
  email           text NOT NULL,
  name            text,
  -- With drive.file scope the app can only see files it created, so a lost
  -- folder id cannot be recovered by searching Drive. This column is the only
  -- pointer back to the user's archive folder.
  drive_folder_id text,
  -- Google OAuth. The refresh token is AES-GCM encrypted with a key derived
  -- from SESSION_SECRET; the access token is short-lived and stored plain.
  google_refresh_token_enc  text,
  google_access_token       text,
  google_token_expires_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Filing
  drive_file_id    text,                     -- null until upload succeeds
  filename         text,

  -- OCR layer (Document AI is the source of truth for text)
  ocr_text         text,
  ocr_provider     text,
  ocr_confidence   real,

  -- Interpretation layer (LLM)
  title            text,
  document_type    text,                     -- open set: tax_notice, utility_bill, ...
  issuer           text,
  document_date    date,
  summary          text,

  action_required  boolean NOT NULL DEFAULT false,
  action_type      text,
  action_date      date,

  retention        retention_status NOT NULL DEFAULT 'unsure',
  retention_reason text,

  extracted_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which model produced the interpretation. Needed the moment models are
  -- A/B-ed, and for re-extracting old rows when a better one lands.
  extraction_model text,

  -- Pipeline state: stages fail and are retried independently
  status           processing_status NOT NULL DEFAULT 'pending',
  error            text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Inbox: newest first, per user
CREATE INDEX documents_user_created_idx ON documents (user_id, created_at DESC);

-- Action list: small subset, so partial
CREATE INDEX documents_action_idx ON documents (user_id, action_date)
  WHERE action_required;

-- Anything still moving through the pipeline
CREATE INDEX documents_status_idx ON documents (status)
  WHERE status NOT IN ('complete', 'failed');

-- Japanese-capable substring search. Trigram, not FTS — see note at top.
CREATE INDEX documents_ocr_trgm_idx   ON documents USING gin (ocr_text gin_trgm_ops);
CREATE INDEX documents_title_trgm_idx ON documents USING gin (title gin_trgm_ops);

-- Structured filters (due dates, amounts) without promoting columns yet
CREATE INDEX documents_extracted_idx ON documents USING gin (extracted_data);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_touch     BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER documents_touch BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- 0003 — cost ledger
--
-- One row per scan ATTEMPT, including attempts that fail after OCR (where the
-- OCR cost was still incurred). Deleting a document or a user leaves the row:
-- this table is for unit economics, and the history must not shrink when the
-- archive does.

CREATE TABLE scan_costs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  document_id        uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  status             text NOT NULL,          -- complete | failed
  stage              text,                   -- where a failed attempt stopped
  lang               text,
  mime_type          text,
  bytes              integer,

  ocr_pages          integer NOT NULL DEFAULT 0,
  model              text,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,

  ocr_usd            numeric(10, 6) NOT NULL DEFAULT 0,
  llm_usd            numeric(10, 6) NOT NULL DEFAULT 0,
  total_usd          numeric(10, 6) NOT NULL DEFAULT 0,
  pricing_as_of      text,                   -- which price table produced the USD figures
  duration_ms        integer
);

CREATE INDEX scan_costs_user_created_idx ON scan_costs (user_id, created_at DESC);
CREATE INDEX scan_costs_created_idx      ON scan_costs (created_at DESC);

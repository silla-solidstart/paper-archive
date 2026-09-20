-- 0006 — labelling, expenses, versioned re-analysis, Drive-first filing
--
-- Labels are fixed machine codes, localised in the UI, never translated
-- copies. Four axes on a document:
--   document_type  what it is physically (existing)
--   categories     what part of life (existing, in extracted_data)
--   handling       what we do with it: todo | expense | record | notice | noise
--   retention      what happens to the paper (existing)
-- plus issuer_key (a stable short name so 東京電力エナジーパートナー and 東京電力
-- group) and keywords (a short bilingual list for cross-language search).
--
-- Re-analysis: extraction_version says which schema/prompt produced the row;
-- document_extractions keeps every run so a re-run never loses anything;
-- user_overrides marks fields the human set, which a re-run must not touch.
--
-- Drive-first: the photo is filed before OCR runs, so a document can exist
-- with drive_file_id set and no interpretation yet (status 'processing').

ALTER TABLE documents
  ADD COLUMN source_lang        text,
  ADD COLUMN handling           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN issuer_key         text,
  ADD COLUMN keywords           text[] NOT NULL DEFAULT '{}',
  ADD COLUMN extraction_version integer NOT NULL DEFAULT 1,
  ADD COLUMN extracted_at       timestamptz,
  ADD COLUMN user_overrides     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN mime_type          text,
  ADD COLUMN bytes              integer;

UPDATE documents SET extracted_at = created_at;

CREATE INDEX documents_handling_idx   ON documents USING gin (handling);
CREATE INDEX documents_keywords_idx   ON documents USING gin (keywords);
CREATE INDEX documents_issuer_key_idx ON documents (space_id, issuer_key);

-- Every extraction run, ingest or re-analysis. The document row always shows
-- the latest; this is the history.
CREATE TABLE document_extractions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  model         text,
  lang          text,
  trigger       text NOT NULL CHECK (trigger IN ('ingest', 'reanalyze')),
  with_image    boolean NOT NULL DEFAULT true,
  data          jsonb NOT NULL,
  cost_usd      numeric(10, 6),
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_extractions_doc_idx ON document_extractions (document_id, created_at DESC);

-- Backfill: what the v1 rows currently say becomes their first history entry.
INSERT INTO document_extractions (document_id, version, model, lang, trigger, with_image, data, cost_usd, input_tokens, output_tokens, created_at)
SELECT id, 1, extraction_model, lang, 'ingest', true,
       jsonb_build_object(
         'title', title, 'document_type', document_type, 'issuer', issuer, 'document_date', document_date,
         'summary', summary, 'action_required', action_required, 'action_type', action_type, 'action_date', action_date,
         'retention', retention, 'retention_reason', retention_reason, 'extracted_data', extracted_data),
       cost_usd, llm_input_tokens, llm_output_tokens, created_at
FROM documents;

-- Money that left the household or business. One row per expense document;
-- line items are best-effort (a supermarket receipt itemises, a tax bill has one line).
CREATE TABLE expenses (
  document_id    uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  space_id       uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  merchant       text,                      -- as printed
  merchant_key   text,                      -- stable short name for grouping
  spent_on       date,
  total          numeric(14, 2),
  tax            numeric(14, 2),
  currency       text NOT NULL DEFAULT 'JPY',
  payment_method text,                      -- cash | card | transfer | direct_debit | other | null
  expense_kind   text NOT NULL,             -- groceries | dining | utilities | ... (src/extract.ts)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_space_date_idx ON expenses (space_id, spent_on DESC);
CREATE INDEX expenses_space_merchant_idx ON expenses (space_id, merchant_key);
CREATE TRIGGER expenses_touch BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE expense_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES expenses(document_id) ON DELETE CASCADE,
  space_id    uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  name        text NOT NULL,                -- as printed
  quantity    numeric(10, 3),
  unit_price  numeric(14, 2),
  amount      numeric(14, 2),
  category    text NOT NULL                 -- snacks | groceries | ... (src/extract.ts)
);
CREATE INDEX expense_items_doc_idx ON expense_items (document_id, position);
CREATE INDEX expense_items_space_cat_idx ON expense_items (space_id, category);

-- The ledger distinguishes first-time ingest from re-analysis, so a bulk
-- re-enrichment shows up as its own line in the cost dashboard.
ALTER TABLE scan_costs ADD COLUMN kind text NOT NULL DEFAULT 'ingest';

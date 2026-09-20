-- 0002 — interpretation language and per-scan cost
--
-- lang: the language the summary / retention_reason were written in (en, ja).
-- Titles and issuers are always as printed on the document, whatever lang is.
-- cost_usd + token counts: from actual usage at ingest, priced by src/pricing.ts
-- at the time; kept so the Recent list can show it without recomputation.

ALTER TABLE documents
  ADD COLUMN lang              text,
  ADD COLUMN cost_usd          numeric(10, 6),
  ADD COLUMN ocr_pages         integer,
  ADD COLUMN llm_input_tokens  integer,
  ADD COLUMN llm_output_tokens integer;

-- 0007 — originals move from the owner's Google Drive to R2
--
-- Decided 2026-09-20: shared archives made the owner's-Drive model
-- problematic (files under one person's grant, ownership untransferable,
-- everyone blocked when that grant lapsed), and dropping the Drive scope
-- removes the consent-screen friction for every user. storage_key is the R2
-- object key; the drive_* columns stay, nullable and unused, so old rows
-- and old code paths do not break mid-deploy.

ALTER TABLE documents ADD COLUMN storage_key text;

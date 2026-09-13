ALTER TYPE "FileProcessingStatus" ADD VALUE IF NOT EXISTS 'DELETED';

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "processing_error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "processing_started_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "extractor_version" TEXT,
  ADD COLUMN IF NOT EXISTS "chunker_version" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;

ALTER TABLE "file_chunks"
  ADD COLUMN IF NOT EXISTS "char_start" INTEGER,
  ADD COLUMN IF NOT EXISTS "char_end" INTEGER,
  ADD COLUMN IF NOT EXISTS "page_start" INTEGER,
  ADD COLUMN IF NOT EXISTS "page_end" INTEGER,
  ADD COLUMN IF NOT EXISTS "chunker_version" TEXT;

CREATE INDEX IF NOT EXISTS "files_workspace_status_active_idx"
  ON "files"("workspace_id", "processing_status", "created_at")
  WHERE "deleted_at" IS NULL;

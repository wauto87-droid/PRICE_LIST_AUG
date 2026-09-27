ALTER TABLE delivery_quote_jobs
  DROP CONSTRAINT IF EXISTS delivery_quote_jobs_status_check;

ALTER TABLE delivery_quote_jobs
  ADD CONSTRAINT delivery_quote_jobs_status_check
  CHECK(status IN ('UPLOADED','PROCESSING','MAPPING','AWAITING_MAPPING','AWAITING_REVIEW','COMPLETED','FAILED'));

ALTER TABLE delivery_quote_jobs
  ADD COLUMN IF NOT EXISTS upload_request_id uuid,
  ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS delivery_quote_jobs_owner_upload_request
  ON delivery_quote_jobs(owner_id,upload_request_id)
  WHERE upload_request_id IS NOT NULL;

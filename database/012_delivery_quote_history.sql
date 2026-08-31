CREATE INDEX delivery_quote_jobs_owner_created ON delivery_quote_jobs(owner_id,created_at DESC);
CREATE INDEX delivery_quote_jobs_owner_updated ON delivery_quote_jobs(owner_id,updated_at DESC);
CREATE INDEX delivery_quote_jobs_status_created ON delivery_quote_jobs(status,created_at DESC);
CREATE INDEX delivery_quote_jobs_quote_updated ON delivery_quote_jobs(quote_id,updated_at DESC) WHERE quote_id IS NOT NULL;

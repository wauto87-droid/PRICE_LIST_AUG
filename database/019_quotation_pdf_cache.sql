CREATE INDEX jobs_quote_pdf_cache ON jobs ((payload->>'quoteId'),(payload->>'fingerprint'),created_at DESC)
WHERE kind='QUOTE_PDF';

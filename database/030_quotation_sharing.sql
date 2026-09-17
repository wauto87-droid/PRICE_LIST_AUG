ALTER TABLE quotations ADD COLUMN IF NOT EXISTS shared_with uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS quotations_shared_with ON quotations USING GIN (shared_with);

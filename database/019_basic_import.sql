ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_mode_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_mode_check
  CHECK(mode IN ('UPDATE_ONLY','CREATE_UPDATE','CREATE_NEW_ONLY'));


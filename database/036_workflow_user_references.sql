CREATE SEQUENCE IF NOT EXISTS workflow_user_reference_seq START WITH 100001;
ALTER TABLE users ADD COLUMN IF NOT EXISTS integration_reference text DEFAULT ('PLU-' || nextval('workflow_user_reference_seq')::text);
UPDATE users SET integration_reference=('PLU-' || nextval('workflow_user_reference_seq')::text) WHERE integration_reference IS NULL;
ALTER TABLE users ALTER COLUMN integration_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_integration_reference_unique ON users(integration_reference);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

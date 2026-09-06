CREATE TABLE commerce_otp_destinations (
  destination_hash text PRIMARY KEY,
  sent_at timestamptz
);
ALTER TABLE customer_accounts ADD COLUMN verified_mobile text;
CREATE UNIQUE INDEX customer_accounts_verified_mobile_unique ON customer_accounts(verified_mobile) WHERE verified_mobile IS NOT NULL;

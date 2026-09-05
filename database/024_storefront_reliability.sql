ALTER TABLE ecommerce_orders ADD COLUMN request_hash text, ADD COLUMN verification_id uuid REFERENCES otp_challenges(id);
CREATE UNIQUE INDEX ecommerce_orders_verification ON ecommerce_orders(verification_id) WHERE verification_id IS NOT NULL;
CREATE INDEX storefront_products ON products(part_number) WHERE active AND storefront_published;
CREATE TABLE storefront_checkout_keys(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());

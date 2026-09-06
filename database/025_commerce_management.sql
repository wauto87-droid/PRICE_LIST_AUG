CREATE TABLE commerce_companies (
 id uuid PRIMARY KEY, customer_id uuid REFERENCES customers(id), name text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED')),
 profile jsonb NOT NULL DEFAULT '{}', review_note text NOT NULL DEFAULT '', price_level text,
 credit_enabled boolean NOT NULL DEFAULT false, credit_limit numeric(20,2) NOT NULL DEFAULT 0 CHECK(credit_limit>=0),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customer_accounts ADD COLUMN company_id uuid REFERENCES commerce_companies(id), ADD COLUMN company_role text NOT NULL DEFAULT 'OWNER' CHECK(company_role IN ('OWNER','BUYER'));
INSERT INTO commerce_companies(id,customer_id,name,status,profile,price_level,credit_enabled,credit_limit)
 SELECT a.id,a.customer_id,COALESCE(c.name,a.email,'Business'),CASE a.status WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'BLOCKED' THEN 'SUSPENDED' ELSE 'PENDING' END,'{"needsReview":true}',a.price_level,a.credit_enabled,COALESCE(a.credit_limit,0)
 FROM customer_accounts a LEFT JOIN customers c ON c.id=a.customer_id;
UPDATE customer_accounts SET company_id=id;
CREATE INDEX company_members ON customer_accounts(company_id);
CREATE TABLE commerce_invitations(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES commerce_companies(id),email text NOT NULL,token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_price_lists(id uuid PRIMARY KEY,name text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1);
ALTER TABLE commerce_companies ADD COLUMN price_list_id uuid REFERENCES commerce_price_lists(id);
CREATE TABLE commerce_prices(id uuid PRIMARY KEY,company_id uuid REFERENCES commerce_companies(id),price_list_id uuid REFERENCES commerce_price_lists(id),product_id uuid NOT NULL REFERENCES products(id),min_quantity numeric(20,6) NOT NULL DEFAULT 1 CHECK(min_quantity>0),price numeric(20,2) NOT NULL CHECK(price>=0),starts_at timestamptz,ends_at timestamptz,version integer NOT NULL DEFAULT 1,CHECK((company_id IS NULL)<>(price_list_id IS NULL)),CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE INDEX commerce_prices_lookup ON commerce_prices(product_id,company_id,price_list_id,min_quantity);
CREATE TABLE commerce_campaigns(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('BANNER','SECTION','OFFER','COUPON')),title text NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','DISABLED')),audience text NOT NULL DEFAULT 'ALL' CHECK(audience IN ('ALL','RETAIL','BUSINESS')),position integer NOT NULL DEFAULT 0,starts_at timestamptz,ends_at timestamptz,data jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE UNIQUE INDEX commerce_coupon_codes ON commerce_campaigns(upper(data->>'code')) WHERE kind='COUPON';
CREATE TABLE commerce_requests(id uuid PRIMARY KEY,number text NOT NULL UNIQUE,company_id uuid NOT NULL REFERENCES commerce_companies(id),account_id uuid NOT NULL REFERENCES customer_accounts(id),status text NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN ('SUBMITTED','REVIEW','QUOTED','ACCEPTED','DECLINED','EXPIRED')),lines jsonb NOT NULL,notes text NOT NULL DEFAULT '',required_date date,quotation_id uuid REFERENCES quotations(id),customer_token text,lead_time text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_attachments(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES commerce_companies(id),request_id uuid REFERENCES commerce_requests(id),name text NOT NULL,mime text NOT NULL,content bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_media(id uuid PRIMARY KEY,content bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ecommerce_orders ADD COLUMN company_id uuid REFERENCES commerce_companies(id),ADD COLUMN hold_expires_at timestamptz,ADD COLUMN fulfillment_data jsonb NOT NULL DEFAULT '{}',ADD COLUMN paid_amount numeric(20,2) NOT NULL DEFAULT 0,ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE ecommerce_orders ADD COLUMN quotation_id uuid REFERENCES quotations(id);
CREATE UNIQUE INDEX commerce_quote_order ON ecommerce_orders(quotation_id) WHERE quotation_id IS NOT NULL;
UPDATE ecommerce_orders o SET company_id=a.company_id FROM customer_accounts a WHERE a.id=o.customer_account_id;
CREATE TABLE commerce_holds(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES ecommerce_orders(id),product_id uuid NOT NULL REFERENCES products(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),quantity numeric(20,6) NOT NULL CHECK(quantity>0),status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED','CONVERTED')),UNIQUE(order_id,product_id));
CREATE INDEX commerce_holds_balance ON commerce_holds(warehouse_id,product_id) WHERE status='ACTIVE';
CREATE TABLE commerce_credit_entries(id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES commerce_companies(id),order_id uuid NOT NULL REFERENCES ecommerce_orders(id),amount numeric(20,2) NOT NULL,kind text NOT NULL CHECK(kind IN ('COMMIT','PAYMENT','RELEASE','REFUND')),idempotency_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO commerce_credit_entries(id,company_id,order_id,amount,kind,idempotency_key) SELECT id,company_id,id,(totals->>'total')::numeric,'COMMIT','COMMIT:'||id::text FROM ecommerce_orders WHERE company_id IS NOT NULL AND payment_method='CREDIT_TERMS' AND status IN ('PENDING_REVIEW','CONFIRMED');
UPDATE ecommerce_orders o SET paid_amount=p.amount FROM payment_transactions p WHERE p.ecommerce_order_id=o.id AND p.status='PAID';
CREATE UNIQUE INDEX commerce_bank_payment_references ON payment_transactions(ecommerce_order_id,provider_reference) WHERE provider='BANK_TRANSFER';
CREATE TABLE commerce_events(id uuid PRIMARY KEY,order_id uuid REFERENCES ecommerce_orders(id),request_id uuid REFERENCES commerce_requests(id),company_id uuid REFERENCES commerce_companies(id),account_id uuid REFERENCES customer_accounts(id),kind text NOT NULL,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_notifications(id uuid PRIMARY KEY,event_id uuid NOT NULL UNIQUE REFERENCES commerce_events(id),destination text NOT NULL,status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','SENDING','SENT','FAILED')),attempts integer NOT NULL DEFAULT 0,error text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_returns(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES ecommerce_orders(id),account_id uuid REFERENCES customer_accounts(id),lines jsonb NOT NULL,reason text NOT NULL,status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','APPROVED','REJECTED','INSPECTED','REFUNDED')),inspection text NOT NULL DEFAULT '',refund_amount numeric(20,2) NOT NULL DEFAULT 0,refund_reference text,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commerce_redemptions(campaign_id uuid NOT NULL REFERENCES commerce_campaigns(id),order_id uuid NOT NULL REFERENCES ecommerce_orders(id),PRIMARY KEY(campaign_id,order_id));
CREATE TABLE commerce_searches(query text PRIMARY KEY,count integer NOT NULL DEFAULT 1,result_count integer NOT NULL,last_at timestamptz NOT NULL DEFAULT now());

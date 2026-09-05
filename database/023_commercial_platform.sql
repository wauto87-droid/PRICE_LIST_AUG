ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_status_check;
ALTER TABLE quotations ADD CONSTRAINT quotations_status_check CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ISSUED','SENT','VIEWED','ACCEPTED','DECLINED','EXPIRED','DELETED'));
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS parent_quotation_id uuid REFERENCES quotations(id), ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS accepted_at timestamptz, ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS quotations_parent_revision ON quotations(parent_quotation_id,revision);

CREATE TABLE approval_rules (
  id uuid PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100, conditions jsonb NOT NULL DEFAULT '{}',
  approver_role text REFERENCES roles(id), approver_user_id uuid REFERENCES users(id),
  tier integer NOT NULL DEFAULT 1 CHECK(tier>0), allow_self_approval boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quotation_approvals (
  id uuid PRIMARY KEY, quotation_id uuid NOT NULL REFERENCES quotations(id), rule_id uuid REFERENCES approval_rules(id),
  tier integer NOT NULL, status text NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid REFERENCES users(id), decided_by uuid REFERENCES users(id), comment text,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);
CREATE INDEX quotation_approvals_queue ON quotation_approvals(status,tier,created_at);
CREATE TABLE quotation_access_tokens (
  id uuid PRIMARY KEY, quotation_id uuid NOT NULL REFERENCES quotations(id), token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, revoked_at timestamptz, first_viewed_at timestamptz, last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0, response text CHECK(response IN ('ACCEPTED','DECLINED')),
  response_note text, responded_at timestamptz, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbound_dispatches (
  id uuid PRIMARY KEY, quotation_id uuid REFERENCES quotations(id), channel text NOT NULL CHECK(channel IN ('EMAIL','WHATSAPP')),
  recipient text NOT NULL, status text NOT NULL CHECK(status IN ('QUEUED','SENDING','SENT','FAILED','CANCELLED')),
  message_snapshot jsonb NOT NULL DEFAULT '{}', attempts integer NOT NULL DEFAULT 0, provider_reference text,
  error text, requested_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, name_ar text NOT NULL DEFAULT '', address jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true, allow_negative_stock boolean NOT NULL DEFAULT false, pickup_enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warehouse_bins (
  id uuid PRIMARY KEY, warehouse_id uuid NOT NULL REFERENCES warehouses(id), code text NOT NULL, name text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
  UNIQUE(warehouse_id,code)
);
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), bin_id uuid REFERENCES warehouse_bins(id),
  kind text NOT NULL CHECK(kind IN ('OPENING','RECEIPT','RESERVE','RELEASE','DELIVERY','RETURN','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','REVERSAL')),
  quantity numeric(20,6) NOT NULL CHECK(quantity<>0), unit_cost numeric(20,6), reference_type text, reference_id uuid,
  reverses_id uuid REFERENCES inventory_movements(id), idempotency_key text UNIQUE, reason text, actor_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_balance ON inventory_movements(warehouse_id,product_id,created_at);
CREATE TABLE fifo_layers (
  id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  source_movement_id uuid NOT NULL REFERENCES inventory_movements(id), received_quantity numeric(20,6) NOT NULL CHECK(received_quantity>0),
  remaining_quantity numeric(20,6) NOT NULL CHECK(remaining_quantity>=0), unit_cost numeric(20,6) NOT NULL CHECK(unit_cost>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fifo_layers_consumption ON fifo_layers(warehouse_id,product_id,created_at) WHERE remaining_quantity>0;
CREATE TABLE fifo_consumptions (
  id uuid PRIMARY KEY, layer_id uuid NOT NULL REFERENCES fifo_layers(id), movement_id uuid NOT NULL REFERENCES inventory_movements(id),
  quantity numeric(20,6) NOT NULL CHECK(quantity>0), unit_cost numeric(20,6) NOT NULL CHECK(unit_cost>=0), UNIQUE(layer_id,movement_id)
);
CREATE TABLE inventory_transfers (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, from_warehouse_id uuid NOT NULL REFERENCES warehouses(id), to_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK(status IN ('DRAFT','POSTED','CANCELLED')), lines jsonb NOT NULL, reason text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), posted_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  CHECK(from_warehouse_id<>to_warehouse_id)
);
CREATE TABLE stock_counts (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK(status IN ('OPEN','COUNTING','REVIEW','POSTED','CANCELLED')), lines jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), posted_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
);

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, quotation_id uuid REFERENCES quotations(id), customer jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','PARTIALLY_RESERVED','RESERVED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED','CLOSED')),
  lines jsonb NOT NULL, totals jsonb NOT NULL, warehouse_id uuid REFERENCES warehouses(id), source text NOT NULL DEFAULT 'QUOTATION',
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_orders_status_date ON sales_orders(status,created_at DESC);
CREATE TABLE stock_reservations (
  id uuid PRIMARY KEY, sales_order_id uuid NOT NULL REFERENCES sales_orders(id), line_key text NOT NULL, product_id uuid NOT NULL REFERENCES products(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id), quantity numeric(20,6) NOT NULL CHECK(quantity>0), status text NOT NULL CHECK(status IN ('ACTIVE','RELEASED','FULFILLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_reservations_available ON stock_reservations(warehouse_id,product_id,status);
CREATE TABLE commercial_documents (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('PROFORMA','DELIVERY_NOTE')), number text NOT NULL UNIQUE,
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id), status text NOT NULL CHECK(status IN ('DRAFT','ISSUED','CANCELLED')),
  snapshot jsonb NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), issued_at timestamptz
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, tax_number text NOT NULL DEFAULT '', contacts jsonb NOT NULL DEFAULT '[]',
  payment_terms text NOT NULL DEFAULT '', currency text NOT NULL DEFAULT 'SAR', lead_time_days integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE supplier_products (
  supplier_id uuid NOT NULL REFERENCES suppliers(id), product_id uuid NOT NULL REFERENCES products(id), supplier_part_number text NOT NULL DEFAULT '',
  pack_size numeric(20,6) NOT NULL DEFAULT 1 CHECK(pack_size>0), last_cost numeric(20,6), currency text NOT NULL DEFAULT 'SAR', preferred boolean NOT NULL DEFAULT false,
  PRIMARY KEY(supplier_id,product_id)
);
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, supplier_id uuid NOT NULL REFERENCES suppliers(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED','CLOSED')),
  currency text NOT NULL DEFAULT 'SAR', exchange_rate numeric(20,8) NOT NULL DEFAULT 1 CHECK(exchange_rate>0), lines jsonb NOT NULL, totals jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL CHECK(status IN ('DRAFT','POSTED','REVERSED')), supplier_invoice_reference text NOT NULL DEFAULT '', lines jsonb NOT NULL,
  landed_costs jsonb NOT NULL DEFAULT '[]', allocations jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id), posted_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
);

CREATE TABLE product_barcodes (
  code text PRIMARY KEY, product_id uuid NOT NULL REFERENCES products(id), unit text NOT NULL DEFAULT 'pcs', multiplier numeric(20,6) NOT NULL DEFAULT 1 CHECK(multiplier>0),
  kind text NOT NULL DEFAULT 'PRODUCT', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE replenishment_settings (
  product_id uuid NOT NULL REFERENCES products(id), warehouse_id uuid NOT NULL REFERENCES warehouses(id), minimum numeric(20,6) NOT NULL DEFAULT 0,
  maximum numeric(20,6), safety_stock numeric(20,6) NOT NULL DEFAULT 0, preferred_supplier_id uuid REFERENCES suppliers(id),
  lead_time_days integer NOT NULL DEFAULT 0, PRIMARY KEY(product_id,warehouse_id)
);

CREATE TABLE storefront_settings (
  id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false, data jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO storefront_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
ALTER TABLE products ADD COLUMN IF NOT EXISTS storefront_published boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS storefront_slug text UNIQUE, ADD COLUMN IF NOT EXISTS storefront_content jsonb NOT NULL DEFAULT '{}';
CREATE TABLE customer_accounts (
  id uuid PRIMARY KEY, customer_id uuid REFERENCES customers(id), email text, mobile text, password_hash text, status text NOT NULL CHECK(status IN ('PENDING','ACTIVE','BLOCKED')),
  price_level text, credit_enabled boolean NOT NULL DEFAULT false, credit_limit numeric(20,2), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(email), UNIQUE(mobile)
);
CREATE TABLE customer_account_sessions (
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_account_sessions_account ON customer_account_sessions(account_id);
CREATE TABLE ecommerce_orders (
  id uuid PRIMARY KEY, number text NOT NULL UNIQUE, customer_account_id uuid REFERENCES customer_accounts(id), guest_contact jsonb,
  status text NOT NULL CHECK(status IN ('PENDING_VERIFICATION','PENDING_PAYMENT','PENDING_REVIEW','CONFIRMED','CANCELLED','FAILED')),
  fulfillment_method text NOT NULL CHECK(fulfillment_method IN ('DELIVERY','PICKUP')), warehouse_id uuid REFERENCES warehouses(id),
  address jsonb, lines jsonb NOT NULL, totals jsonb NOT NULL, payment_method text NOT NULL,
  sales_order_id uuid REFERENCES sales_orders(id), idempotency_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY, ecommerce_order_id uuid NOT NULL REFERENCES ecommerce_orders(id), provider text NOT NULL, provider_reference text,
  status text NOT NULL CHECK(status IN ('CREATED','AUTHORIZED','PAID','FAILED','REFUNDED','CANCELLED')),
  amount numeric(20,2) NOT NULL CHECK(amount>=0), currency text NOT NULL DEFAULT 'SAR', request_key text NOT NULL UNIQUE,
  provider_payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true, rules jsonb NOT NULL DEFAULT '{}', fee numeric(20,2) NOT NULL DEFAULT 0, free_above numeric(20,2)
);
CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY, purpose text NOT NULL, destination_hash text NOT NULL, code_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL, verified_at timestamptz, verification_token_hash text, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

UPDATE roles SET permissions=array_append(permissions,'COMMERCIAL_VIEW') WHERE id='ADMIN' AND NOT ('COMMERCIAL_VIEW'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'QUOTE_APPROVE') WHERE id='ADMIN' AND NOT ('QUOTE_APPROVE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'SALES_ORDER_MANAGE') WHERE id='ADMIN' AND NOT ('SALES_ORDER_MANAGE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'INVENTORY_VIEW') WHERE id='ADMIN' AND NOT ('INVENTORY_VIEW'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'INVENTORY_MANAGE') WHERE id='ADMIN' AND NOT ('INVENTORY_MANAGE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'INVENTORY_OVERRIDE') WHERE id='ADMIN' AND NOT ('INVENTORY_OVERRIDE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'COST_ACCOUNTING_VIEW') WHERE id='ADMIN' AND NOT ('COST_ACCOUNTING_VIEW'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'PURCHASE_MANAGE') WHERE id='ADMIN' AND NOT ('PURCHASE_MANAGE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'STOREFRONT_MANAGE') WHERE id='ADMIN' AND NOT ('STOREFRONT_MANAGE'=ANY(permissions));

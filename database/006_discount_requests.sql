CREATE TABLE discount_requests (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  part_number text NOT NULL,
  product_snapshot jsonb NOT NULL DEFAULT '{}',
  selling_level text NOT NULL CHECK(selling_level IN ('WHOLESALE','RETAIL','END_CUSTOMER')),
  quantity numeric(20,6) NOT NULL CHECK(quantity > 0),
  requested_discount numeric(9,6) NOT NULL CHECK(requested_discount BETWEEN 0 AND 100),
  requested_final_price numeric(20,2) NOT NULL CHECK(requested_final_price >= 0),
  protected_price numeric(20,2) NOT NULL CHECK(protected_price >= 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX discount_requests_status_created ON discount_requests(status, created_at DESC);
CREATE INDEX discount_requests_product_created ON discount_requests(product_id, created_at DESC);

CREATE TABLE discount_request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES discount_requests(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL CHECK(action IN ('CREATED','APPROVED','REJECTED')),
  note text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX discount_request_events_request_created ON discount_request_events(request_id, created_at ASC);

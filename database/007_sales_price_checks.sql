CREATE TABLE sales_price_reports (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  file_path text NOT NULL,
  status text NOT NULL CHECK(status IN ('UPLOADED','PROCESSING','AWAITING_MAPPING','READY','FAILED')),
  owner_id uuid NOT NULL REFERENCES users(id),
  mapping jsonb NOT NULL DEFAULT '{}',
  columns jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  error text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_price_rows (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES sales_price_reports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  source_part text,
  quantity numeric(20,6),
  sales_price numeric(20,6),
  product_id uuid REFERENCES products(id),
  product_version integer,
  matched_part text,
  description text,
  list_price numeric(20,6),
  list_total numeric(20,2),
  actual_total numeric(20,2),
  discount_percent numeric(20,6),
  match_type text,
  status text NOT NULL DEFAULT 'PENDING',
  error text,
  UNIQUE(report_id,row_number)
);
CREATE INDEX sales_price_rows_report_row ON sales_price_rows(report_id,row_number);
CREATE INDEX sales_price_reports_created ON sales_price_reports(created_at DESC);
UPDATE roles SET permissions=array_append(permissions,'SALES_PRICE_CHECK') WHERE id='ADMIN' AND NOT ('SALES_PRICE_CHECK'=ANY(permissions));

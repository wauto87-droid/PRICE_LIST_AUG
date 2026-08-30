CREATE TABLE delivery_quote_jobs (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  file_path text NOT NULL,
  status text NOT NULL CHECK(status IN ('UPLOADED','PROCESSING','AWAITING_MAPPING','AWAITING_REVIEW','COMPLETED','FAILED')),
  owner_id uuid NOT NULL REFERENCES users(id),
  mapping jsonb NOT NULL DEFAULT '{}',
  header jsonb NOT NULL DEFAULT '{}',
  summary jsonb NOT NULL DEFAULT '{}',
  error text,
  quote_id uuid REFERENCES quotations(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE delivery_quote_rows (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES delivery_quote_jobs(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  resolution text NOT NULL DEFAULT 'BLOCKED' CHECK(resolution IN ('MATCHED_CATALOG','UNMATCHED_CUSTOM','BLOCKED')),
  action text NOT NULL DEFAULT 'ADD' CHECK(action IN ('ADD','REMOVE')),
  completed boolean NOT NULL DEFAULT false,
  issues jsonb NOT NULL DEFAULT '[]',
  line_input jsonb NOT NULL DEFAULT '{}',
  source_price text,
  product_id uuid REFERENCES products(id),
  UNIQUE(job_id,row_number)
);
CREATE INDEX delivery_quote_jobs_created ON delivery_quote_jobs(created_at DESC);
CREATE INDEX delivery_quote_rows_job_row ON delivery_quote_rows(job_id,row_number);

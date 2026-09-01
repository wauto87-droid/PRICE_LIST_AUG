ALTER TABLE products ADD COLUMN details jsonb NOT NULL DEFAULT '{"manufacturer":"","productName":"","productType":"","series":"","specifications":[],"applications":[]}'::jsonb;

CREATE TABLE app_secrets (
  key text PRIMARY KEY,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_enrichment_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('PENDING','RUNNING','READY','FAILED','DELETED')),
  filters jsonb NOT NULL DEFAULT '{}',
  progress jsonb NOT NULL DEFAULT '{}',
  model text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX product_enrichment_jobs_owner_date ON product_enrichment_jobs(owner_id,created_at DESC);

CREATE TABLE product_enrichment_rows (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES product_enrichment_jobs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  expected_version integer NOT NULL,
  source_part text NOT NULL,
  original_description text NOT NULL,
  original_details jsonb NOT NULL DEFAULT '{}',
  suggestion jsonb,
  sources jsonb NOT NULL DEFAULT '[]',
  confidence text,
  status text NOT NULL CHECK(status IN ('PENDING','PROCESSING','FOUND','UNCERTAIN','NOT_FOUND','FAILED','CONFIRMED')),
  error text,
  reviewed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,product_id)
);
CREATE INDEX product_enrichment_rows_job_status ON product_enrichment_rows(job_id,status,id);

UPDATE roles SET permissions=array_append(permissions,'AI_PRODUCT_ENRICH')
WHERE id='ADMIN' AND NOT ('AI_PRODUCT_ENRICH'=ANY(permissions));

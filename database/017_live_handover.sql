ALTER TABLE product_aliases
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0 CHECK(usage_count>=0),
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0);

ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS source_job_id uuid REFERENCES import_jobs(id) ON DELETE SET NULL;
ALTER TABLE delivery_quote_jobs
  ADD COLUMN IF NOT EXISTS source_job_id uuid REFERENCES delivery_quote_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS import_jobs_source_job ON import_jobs(source_job_id);
CREATE INDEX IF NOT EXISTS delivery_quote_jobs_source_job ON delivery_quote_jobs(source_job_id);

CREATE TABLE quotation_templates (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  content jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quotation_template_users (
  template_id uuid NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(template_id,user_id)
);
CREATE INDEX quotation_templates_status_updated ON quotation_templates(status,updated_at DESC);
CREATE INDEX quotation_template_users_user ON quotation_template_users(user_id,template_id);

ALTER TABLE price_watch_events
  ADD COLUMN IF NOT EXISTS adjustment_mode text NOT NULL DEFAULT 'DISCOUNT'
  CHECK(adjustment_mode IN ('DISCOUNT','MARKUP'));
UPDATE price_watch_events SET adjustment_mode='MARKUP'
WHERE requested_markup<>0 OR effective_markup<>0;

UPDATE roles SET permissions=array_append(permissions,'DELIVERY_ALIAS_MANAGE')
WHERE id='ADMIN' AND NOT ('DELIVERY_ALIAS_MANAGE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'QUOTE_TEMPLATE_MANAGE')
WHERE id='ADMIN' AND NOT ('QUOTE_TEMPLATE_MANAGE'=ANY(permissions));
UPDATE roles SET permissions=array_append(permissions,'QUOTE_PRICE_HISTORY')
WHERE id='ADMIN' AND NOT ('QUOTE_PRICE_HISTORY'=ANY(permissions));

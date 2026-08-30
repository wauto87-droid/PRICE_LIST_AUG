CREATE TABLE reusable_custom_items (
  id uuid PRIMARY KEY,
  reference text NOT NULL DEFAULT '',
  normalized_reference text NOT NULL DEFAULT '',
  description text NOT NULL,
  normalized_description text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  suggested_unit_price numeric(20,6) NOT NULL CHECK(suggested_unit_price >= 0),
  suggested_discount numeric(8,4) NOT NULL DEFAULT 0 CHECK(suggested_discount BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONVERTED')),
  product_id uuid REFERENCES products(id),
  created_by uuid NOT NULL REFERENCES users(id),
  usage_count integer NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
  last_used_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='CONVERTED')=(product_id IS NOT NULL))
);
CREATE UNIQUE INDEX reusable_custom_active_reference ON reusable_custom_items(normalized_reference) WHERE status='ACTIVE' AND normalized_reference<>'';
CREATE UNIQUE INDEX reusable_custom_active_description ON reusable_custom_items(normalized_description) WHERE status='ACTIVE';
CREATE INDEX reusable_custom_search ON reusable_custom_items(status,updated_at DESC);
UPDATE roles SET permissions=array_append(permissions,'REUSABLE_CUSTOM_MANAGE') WHERE id='ADMIN' AND NOT ('REUSABLE_CUSTOM_MANAGE'=ANY(permissions));

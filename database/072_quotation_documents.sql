-- Old outbox rows have no trustworthy creation timestamp. Do not backfill one.
ALTER TABLE sw_job_outbox ADD COLUMN created_at timestamptz;
ALTER TABLE sw_job_outbox ALTER COLUMN created_at SET DEFAULT now();
CREATE TABLE quotation_document_snapshots (
  quotation_id uuid NOT NULL REFERENCES quotations(id),
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(quotation_id,version)
);
CREATE TABLE quotation_revision_sources (
  quotation_id uuid PRIMARY KEY REFERENCES quotations(id),
  root_document_id uuid NOT NULL REFERENCES quotations(id),
  source_version integer,
  request_id text,
  line_mapping jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quotation_revision_request ON quotation_revision_sources(request_id) WHERE request_id IS NOT NULL;
CREATE TABLE quotation_reference_provenance (
  document_id uuid NOT NULL REFERENCES quotations(id),
  source_version integer NOT NULL,
  item_id text NOT NULL,
  part_number text NOT NULL,
  evidence_hash text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,source_version,item_id,evidence_hash)
);
CREATE TABLE quotation_workflow_publications (
  quotation_id uuid NOT NULL REFERENCES quotations(id),
  version integer NOT NULL,
  event_id text NOT NULL UNIQUE,
  root_document_id uuid NOT NULL REFERENCES quotations(id),
  request_id text,
  remote_version integer,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','SYNCED','CONFLICT')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(quotation_id,version)
);
CREATE FUNCTION immutable_quotation_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical quotation records are append-only';
END
$$;
CREATE TRIGGER immutable_quotation_snapshot BEFORE UPDATE OR DELETE ON quotation_document_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_quotation_record();
CREATE TRIGGER immutable_quotation_provenance BEFORE UPDATE OR DELETE ON quotation_reference_provenance FOR EACH ROW EXECUTE FUNCTION immutable_quotation_record();

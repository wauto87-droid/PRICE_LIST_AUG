CREATE TABLE quantity_reports (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  file_path text NOT NULL,
  status text NOT NULL CHECK(status IN ('UPLOADED','PROCESSING','AWAITING_MAPPING','READY','FAILED')),
  owner_id uuid NOT NULL REFERENCES users(id),
  mapping jsonb NOT NULL DEFAULT '{}',
  columns jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  progress jsonb NOT NULL DEFAULT '{}',
  error text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quantity_report_rows (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES quantity_reports(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw jsonb NOT NULL,
  source_part text,
  quantity numeric(20,6),
  status text NOT NULL DEFAULT 'PENDING',
  error text,
  UNIQUE(report_id,row_number)
);
CREATE TABLE quantity_report_groups (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES quantity_reports(id) ON DELETE CASCADE,
  source_part text NOT NULL,
  sold_quantity numeric(20,6) NOT NULL,
  returned_quantity numeric(20,6) NOT NULL,
  net_quantity numeric(20,6) NOT NULL,
  occurrences integer NOT NULL,
  first_row integer NOT NULL,
  UNIQUE(report_id,source_part)
);
CREATE INDEX quantity_reports_created ON quantity_reports(created_at DESC);
CREATE INDEX quantity_rows_report_row ON quantity_report_rows(report_id,row_number);
CREATE INDEX quantity_groups_report_part ON quantity_report_groups(report_id,source_part);
UPDATE roles SET permissions=array_append(permissions,'QUANTITY_FINDER') WHERE id='ADMIN' AND NOT ('QUANTITY_FINDER'=ANY(permissions));

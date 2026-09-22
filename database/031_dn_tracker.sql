CREATE TABLE dn_reports (
 id uuid PRIMARY KEY, name text NOT NULL, version integer NOT NULL DEFAULT 1,
 current_snapshot uuid, archived boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dn_snapshots (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES dn_reports(id),
 filename text NOT NULL, report_date date NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), state text NOT NULL CHECK(state IN ('PREVIEW','CURRENT','ARCHIVED')),
 base_version integer NOT NULL, digest text NOT NULL, issues jsonb NOT NULL DEFAULT '[]', comparison jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE dn_notes (
 id uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES dn_reports(id), identity_key text NOT NULL,
 stage text NOT NULL DEFAULT 'REVIEW' CHECK(stage IN ('REVIEW','FOLLOW_UP','READY','RESOLVED')),
 assignee uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 needs_review boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(report_id,identity_key)
);
CREATE TABLE dn_entries (
 snapshot_id uuid NOT NULL REFERENCES dn_snapshots(id), identity_key text NOT NULL,
 customer_key text NOT NULL, customer text NOT NULL, customer_code text NOT NULL DEFAULT '',
 doc_no text NOT NULL, doc_date date NOT NULL, billing text NOT NULL,
 outstanding integer NOT NULL, has_returns boolean NOT NULL, search_text text NOT NULL,
 quantities jsonb NOT NULL, lines jsonb NOT NULL, digest text NOT NULL,
 PRIMARY KEY(snapshot_id,identity_key)
);
CREATE INDEX dn_entries_customer ON dn_entries(snapshot_id,customer_key,doc_date);
CREATE TABLE dn_events (
 id uuid PRIMARY KEY, note_id uuid NOT NULL REFERENCES dn_notes(id), actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL, content text NOT NULL, before_value jsonb, after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dn_events_note ON dn_events(note_id,created_at);
CREATE TABLE dn_saved_views (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('PRESET','GROUP')), name text NOT NULL,
 content jsonb NOT NULL, version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
UPDATE roles SET permissions=permissions || ARRAY['DN_TRACKER_VIEW','DN_TRACKER_EDIT','DN_TRACKER_MANAGE'] WHERE id='ADMIN';

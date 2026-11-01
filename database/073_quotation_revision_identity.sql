ALTER TABLE quotation_revision_sources ADD COLUMN source_document_id uuid REFERENCES quotations(id);
ALTER TABLE quotations ADD COLUMN document_currency text CHECK(document_currency IS NULL OR document_currency ~ '^[A-Z]{3}$');
ALTER TABLE quotation_revision_sources ADD COLUMN reference_requirements jsonb NOT NULL DEFAULT '{}';

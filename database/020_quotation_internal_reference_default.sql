ALTER TABLE quotations ALTER COLUMN internal_reference SET DEFAULT
  ('QID-' || lpad(nextval('quotation_internal_reference_seq')::text, 6, '0'));


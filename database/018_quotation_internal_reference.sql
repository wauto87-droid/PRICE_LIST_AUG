CREATE SEQUENCE quotation_internal_reference_seq AS bigint START WITH 1 NO CYCLE;

ALTER TABLE quotations ADD COLUMN internal_reference text;

WITH numbered AS (
  SELECT id,row_number() OVER (ORDER BY created_at,id) AS serial
  FROM quotations
)
UPDATE quotations q
SET internal_reference='QID-'||lpad(numbered.serial::text,6,'0')
FROM numbered
WHERE q.id=numbered.id;

ALTER TABLE quotations ALTER COLUMN internal_reference SET NOT NULL;
ALTER TABLE quotations ADD CONSTRAINT quotations_internal_reference_unique UNIQUE(internal_reference);

SELECT setval(
  'quotation_internal_reference_seq',
  COALESCE((SELECT max(substring(internal_reference FROM '([0-9]+)$')::bigint)+1 FROM quotations),1),
  false
);

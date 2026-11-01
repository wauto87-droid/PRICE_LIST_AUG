UPDATE roles
SET permissions = array_append(permissions, 'QUOTE_PRICE_HISTORY')
WHERE id IN ('STAFF', 'MANAGER')
  AND NOT ('QUOTE_PRICE_HISTORY' = ANY(permissions));

CREATE INDEX IF NOT EXISTS products_lookup_clean_part_prefix
ON products ((regexp_replace(normalized_part, '[^[:alnum:]]+', '', 'g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS aliases_lookup_clean_part_prefix
ON product_aliases ((regexp_replace(normalized, '[^[:alnum:]]+', '', 'g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS products_lookup_clean_part_trgm
ON products USING gin ((regexp_replace(normalized_part, '[^[:alnum:]]+', '', 'g')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS aliases_lookup_clean_part_trgm
ON product_aliases USING gin ((regexp_replace(normalized, '[^[:alnum:]]+', '', 'g')) gin_trgm_ops);

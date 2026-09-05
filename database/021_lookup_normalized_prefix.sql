CREATE INDEX IF NOT EXISTS products_lookup_part_format_prefix
ON products ((regexp_replace(normalized_part,'[[:space:]./_-]+','','g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS aliases_lookup_part_format_prefix
ON product_aliases ((regexp_replace(normalized,'[[:space:]./_-]+','','g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS products_lookup_part_format_trgm
ON products USING gin ((regexp_replace(normalized_part,'[[:space:]./_-]+','','g')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS aliases_lookup_part_format_trgm
ON product_aliases USING gin ((regexp_replace(normalized,'[[:space:]./_-]+','','g')) gin_trgm_ops);

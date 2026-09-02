CREATE INDEX products_lookup_part_format
ON products ((regexp_replace(normalized_part,'[[:space:]./_-]+','','g')));

CREATE INDEX aliases_lookup_part_format
ON product_aliases ((regexp_replace(normalized,'[[:space:]./_-]+','','g')));

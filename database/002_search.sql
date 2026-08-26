CREATE INDEX aliases_trgm ON product_aliases USING gin(normalized gin_trgm_ops);
CREATE INDEX brands_name_trgm ON brands USING gin(name gin_trgm_ops);
CREATE INDEX categories_name_trgm ON categories USING gin(name gin_trgm_ops);
